#!/usr/bin/env python3
"""Independent cross-check of fpv-sim-app's DIS traffic (IEEE 1278.1).

Every PDU here is decoded and encoded exclusively with open-dis-python,
a second, independent implementation of the standard. The app's own
codec is never imported, so agreement between the two ends is evidence
about the wire format itself, not about one codebase agreeing with
itself.

Two modes:

  receive  Bind a UDP port and score a live PDU stream against the
           documented contract (docs/INTEROP.md): PDU types, wire
           lengths, site:app identity, entity numbering, force IDs,
           markings, geodetic positions near the anchor, EE beam
           frequencies. Prints a scorecard and exits nonzero on any
           violation, or if no Entity State PDUs arrive at all.

  send     Emit an Entity State orbit (an external entity circling the
           anchor) encoded by open-dis-python's own encoder, so the
           app's receive path must ingest a foreign implementation's
           bytes.

Requires open-dis-python. PyPI's opendis 1.0 pins numpy<2 (which does
not install on Python 3.13), so install the pinned upstream commit,
which needs no numpy:

  pip install "git+https://github.com/open-dis/open-dis-python@732b6655bb47e34ccc73722eefe0f4706fd0032f"

Typical use (driven automatically by scripts/interop-check.mjs):

  python tools/dis-crosscheck.py receive --port 3000 --duration 20 --anchor 21.35,-157.95
  python tools/dis-crosscheck.py send --port 3000 --anchor 21.35,-157.95 --site 3 --app 5001
"""

import argparse
import json
import math
import re
import socket
import sys
import time
from io import BytesIO

from opendis.PduFactory import createPdu
from opendis.RangeCoordinates import GPS
from opendis.dis7 import EntityStatePdu
from opendis.stream import DataOutputStream

GPS_CONV = GPS()  # WGS84 utilities; lla2ecef/ecef2lla work in decimal degrees

# The documented wire contract (docs/INTEROP.md, src/main/gateway/config.ts
# defaults). Types: 1 Entity State, 2 Fire, 3 Detonation, 13 Start/Resume,
# 14 Stop/Freeze, 23 Electromagnetic Emission.
ALLOWED_TYPES = {1, 2, 3, 13, 14, 23}
TYPE_NAMES = {1: "EntityState", 2: "Fire", 3: "Detonation", 13: "StartResume", 14: "StopFreeze", 23: "EmissionEE"}
FIXED_LENGTHS = {1: 144, 2: 96, 3: 104, 13: 44, 14: 40}

# Entity number scheme: BLUFOR statics 1 (GCS), 2, 3 (DF nodes), drones
# 10+n; OPFOR statics 101, 102, 103, drones 110+n. Force IDs 1 and 2.
BLUFOR_STATICS = {1, 2, 3}
OPFOR_STATICS = {101, 102, 103}
GCS_ENTITIES = {1, 101}
MARKING_RE = re.compile(r"^[BO]-[A-Za-z0-9-]{1,9}$")

UPLINK_HZ, UPLINK_TOL_HZ = 915.0e6, 5.0e6
VIDEO_HZ, VIDEO_TOL_HZ = 5.8e9, 20.0e6

M_PER_DEG_LAT = 111132.9


def expected_force(entity_number):
    """1 for BLUFOR-numbered entities, 2 for OPFOR, None if undocumented."""
    if entity_number in BLUFOR_STATICS or 11 <= entity_number <= 99:
        return 1
    if entity_number in OPFOR_STATICS or 111 <= entity_number <= 199:
        return 2
    return None


def is_drone_number(entity_number):
    return (11 <= entity_number <= 99) or (111 <= entity_number <= 199)


def parse_anchor(text):
    parts = [float(p) for p in text.split(",")]
    if len(parts) == 2:
        parts.append(0.0)
    if len(parts) != 3:
        raise SystemExit(f"--anchor must be lat,lon or lat,lon,h (got {text!r})")
    return parts[0], parts[1], parts[2]


def horizontal_offset_m(lat_deg, lon_deg, lat0_deg, lon0_deg):
    d_north = (lat_deg - lat0_deg) * M_PER_DEG_LAT
    d_east = (lon_deg - lon0_deg) * 111319.5 * math.cos(math.radians(lat0_deg))
    return math.hypot(d_east, d_north)


class Scorecard:
    def __init__(self):
        self.datagrams = 0
        self.parsed = 0
        self.type_counts = {}
        self.espdu_entities = {}
        self.markings = set()
        self.force_counts = {}
        self.ee_uplink = 0
        self.ee_video = 0
        self.ee_silent = 0
        self.detonation_results = {}
        self.stop_freeze_reasons = {}
        self.max_offset_m = 0.0
        self.alt_lo = None
        self.alt_hi = None
        self.senders = set()
        self.violations = []  # (category, detail)

    def violation(self, category, detail):
        self.violations.append((category, detail))

    def category_count(self, category):
        return sum(1 for c, _ in self.violations if c == category)


def score_espdu(pdu, card, args):
    sa = pdu.entityID.simulationAddress
    num = pdu.entityID.entityNumber
    key = f"{sa.site}:{sa.application}:{num}"
    card.espdu_entities[key] = card.espdu_entities.get(key, 0) + 1
    card.force_counts[pdu.forceId] = card.force_counts.get(pdu.forceId, 0) + 1

    if (sa.site, sa.application) != (args.exp_site, args.exp_app):
        card.violation("identity", f"ESPDU from {sa.site}:{sa.application}, expected {args.exp_site}:{args.exp_app}")
    force = expected_force(num)
    if force is None:
        card.violation("identity", f"entity number {num} outside the documented scheme")
    if pdu.forceId not in (1, 2):
        card.violation("identity", f"force ID {pdu.forceId} on entity {num}, expected 1 or 2")
    elif force is not None and pdu.forceId != force:
        card.violation("identity", f"entity {num} carries force {pdu.forceId}, expected {force}")

    marking = pdu.marking.charactersString()
    card.markings.add(marking)
    if not MARKING_RE.match(marking):
        card.violation("identity", f"marking {marking!r} on entity {num} is not a documented ASCII marking")
    elif force is not None and marking[0] != ("B" if force == 1 else "O"):
        card.violation("identity", f"marking {marking!r} side prefix disagrees with force {force}")

    loc = pdu.entityLocation
    lat, lon, alt = GPS_CONV.ecef2lla([loc.x, loc.y, loc.z])
    off = horizontal_offset_m(lat, lon, args.anchor_lat, args.anchor_lon)
    card.max_offset_m = max(card.max_offset_m, off)
    d_alt = alt - args.anchor_h
    card.alt_lo = d_alt if card.alt_lo is None else min(card.alt_lo, d_alt)
    card.alt_hi = d_alt if card.alt_hi is None else max(card.alt_hi, d_alt)
    if off > args.max_offset_m:
        card.violation("geodesy", f"entity {num} {off:.0f} m from the anchor (limit {args.max_offset_m:.0f} m)")
    if not (-60.0 <= d_alt <= 500.0):
        card.violation("geodesy", f"entity {num} altitude {d_alt:.1f} m relative to the anchor (limit -60..500 m)")


def score_emission(pdu, card, wire_len, args):
    sa = pdu.emittingEntityID.simulationAddress
    num = pdu.emittingEntityID.entityNumber
    if (sa.site, sa.application) != (args.exp_site, args.exp_app):
        card.violation("emissions", f"EE from {sa.site}:{sa.application}, expected {args.exp_site}:{args.exp_app}")
    if expected_force(num) is None:
        card.violation("emissions", f"EE emitter entity {num} outside the documented scheme")
    if pdu.numberOfSystems != 1 or len(pdu.systems) != 1:
        card.violation("emissions", f"EE with {pdu.numberOfSystems} systems, expected exactly 1")
        return
    beams = pdu.systems[0].beamRecords
    if len(beams) not in (0, 1):
        card.violation("emissions", f"EE from entity {num} with {len(beams)} beams, expected 0 or 1")
        return
    expected_len = 28 + 20 + 52 * len(beams)
    if wire_len != expected_len:
        card.violation("lengths", f"EE wire length {wire_len} B with {len(beams)} beam(s), expected {expected_len}")
    if len(beams) == 0:
        card.ee_silent += 1
        return
    freq = beams[0].fundamentalParameterData.frequency
    if abs(freq - UPLINK_HZ) <= UPLINK_TOL_HZ:
        card.ee_uplink += 1
        if num not in GCS_ENTITIES:
            card.violation("emissions", f"uplink beam ({freq/1e6:.1f} MHz) from non-GCS entity {num}")
    elif abs(freq - VIDEO_HZ) <= VIDEO_TOL_HZ:
        card.ee_video += 1
        if not is_drone_number(num):
            card.violation("emissions", f"video beam ({freq/1e9:.3f} GHz) from non-drone entity {num}")
    else:
        card.violation("emissions", f"beam frequency {freq:.0f} Hz is neither 915 MHz nor 5.8 GHz")


def score_datagram(data, card, args):
    if len(data) < 12:
        card.violation("parse", f"{len(data)} B datagram is shorter than a PDU header")
        return None
    version, exercise, ptype = data[0], data[1], data[2]
    card.type_counts[ptype] = card.type_counts.get(ptype, 0) + 1
    if ptype not in ALLOWED_TYPES:
        card.violation("types", f"unexpected PDU type {ptype}")
        return None
    if exercise != args.exercise:
        card.violation("identity", f"exercise {exercise} on a type {ptype} PDU, expected {args.exercise}")
    if version != 6:
        card.violation("types", f"protocol version {version} on a type {ptype} PDU, expected 6")

    try:
        pdu = createPdu(data)
    except Exception as exc:  # noqa: BLE001 - scoring, not crashing
        card.violation("parse", f"open-dis failed to parse a type {ptype} PDU: {exc}")
        return None
    if pdu is None:
        card.violation("parse", f"open-dis has no decoder for PDU type {ptype}")
        return None
    card.parsed += 1

    fixed = FIXED_LENGTHS.get(ptype)
    if fixed is not None and len(data) != fixed:
        card.violation("lengths", f"type {ptype} datagram is {len(data)} B, expected {fixed}")
    if pdu.length != len(data):
        card.violation("lengths", f"type {ptype} header length {pdu.length} != wire length {len(data)}")

    if ptype == 1:
        score_espdu(pdu, card, args)
    elif ptype == 23:
        score_emission(pdu, card, len(data), args)
    elif ptype == 3:
        card.detonation_results[pdu.detonationResult] = card.detonation_results.get(pdu.detonationResult, 0) + 1
    elif ptype == 14:
        card.stop_freeze_reasons[pdu.reason] = card.stop_freeze_reasons.get(pdu.reason, 0) + 1
    return pdu


def print_scorecard(card, args, elapsed_s):
    espdus = card.type_counts.get(1, 0)
    print("== dis-crosscheck receive scorecard ==")
    print(f"listened on {args.bind}:{args.port} for {elapsed_s:.1f} s; "
          f"{card.datagrams} datagrams from {sorted(card.senders) or ['nobody']}")
    counts = " ".join(f"{TYPE_NAMES.get(t, t)}={n}" for t, n in sorted(card.type_counts.items()))
    print(f"type counts: {counts if counts else 'none'}")
    ents = " ".join(f"{k}={v}" for k, v in sorted(card.espdu_entities.items(), key=lambda kv: kv[0]))
    print(f"espdu by entity: {ents if ents else 'none'}")
    print(f"force ids: {dict(sorted(card.force_counts.items()))}; markings: {','.join(sorted(card.markings)) or 'none'}")
    print(f"ee beams: uplink915={card.ee_uplink} video5800={card.ee_video} silent={card.ee_silent}")
    if espdus > 0 and card.alt_lo is not None:
        print(f"geodesy: max horizontal offset {card.max_offset_m:.0f} m; "
              f"altitude {card.alt_lo:.1f}..{card.alt_hi:.1f} m relative to the anchor")
    if card.detonation_results:
        print(f"detonation results: {dict(sorted(card.detonation_results.items()))}")
    if card.stop_freeze_reasons:
        print(f"stop/freeze reasons: {dict(sorted(card.stop_freeze_reasons.items()))}")

    checks = [
        ("all datagrams parse with open-dis", card.category_count("parse") == 0 and card.parsed == card.datagrams),
        ("PDU types and protocol version as documented", card.category_count("types") == 0),
        ("site:app, entity numbers, force IDs, markings", card.category_count("identity") == 0),
        ("geodetic positions near the anchor", card.category_count("geodesy") == 0),
        ("EE beam counts and frequencies", card.category_count("emissions") == 0),
        ("wire lengths per PDU type", card.category_count("lengths") == 0),
    ]
    for name, ok in checks:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    for category, detail in card.violations[:args.max_violation_lines]:
        print(f"  violation ({category}): {detail}")
    hidden = len(card.violations) - args.max_violation_lines
    if hidden > 0:
        print(f"  ... and {hidden} more violations")
    print(f"violations: {len(card.violations)}")

    ok = len(card.violations) == 0 and espdus >= args.min_espdus
    if espdus < args.min_espdus:
        print(f"RESULT: FAIL (only {espdus} Entity State PDUs arrived, expected at least {args.min_espdus})")
    else:
        print(f"RESULT: {'PASS' if ok else 'FAIL'}")

    summary = {
        "datagrams": card.datagrams,
        "parsed": card.parsed,
        "types": {TYPE_NAMES.get(t, str(t)): n for t, n in sorted(card.type_counts.items())},
        "espdu": espdus,
        "espduEntities": dict(sorted(card.espdu_entities.items())),
        "markings": sorted(card.markings),
        "eeUplink": card.ee_uplink,
        "eeVideo": card.ee_video,
        "eeSilent": card.ee_silent,
        "detonation": card.type_counts.get(3, 0),
        "fire": card.type_counts.get(2, 0),
        "startResume": card.type_counts.get(13, 0),
        "stopFreeze": card.type_counts.get(14, 0),
        "violations": len(card.violations),
        "result": "PASS" if ok else "FAIL",
    }
    print("SCORECARD-JSON " + json.dumps(summary), flush=True)
    return ok, espdus


def run_receive(args):
    args.anchor_lat, args.anchor_lon, args.anchor_h = parse_anchor(args.anchor)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8 * 1024 * 1024)
    except OSError:
        pass
    sock.bind((args.bind, args.port))
    sock.settimeout(0.25)
    print(f"READY {args.bind}:{args.port} duration {args.duration}s exercise {args.exercise}", flush=True)

    card = Scorecard()
    started = time.monotonic()
    deadline = started + args.duration
    termination_at = None
    while time.monotonic() < deadline:
        if termination_at is not None and time.monotonic() - termination_at > args.linger:
            break
        try:
            data, addr = sock.recvfrom(65535)
        except socket.timeout:
            continue
        card.datagrams += 1
        card.senders.add(addr[0])
        pdu = score_datagram(data, card, args)
        # A Stop/Freeze with reason 2 (Termination) is the end-of-session
        # sentinel: linger briefly for stragglers, then finish early.
        if pdu is not None and data[2] == 14 and getattr(pdu, "reason", None) == 2:
            termination_at = time.monotonic()
    elapsed = time.monotonic() - started
    sock.close()

    ok, espdus = print_scorecard(card, args, elapsed)
    if espdus < args.min_espdus:
        return 2
    return 0 if ok else 1


def dis_timestamp_relative():
    ms_past_hour = (time.time() * 1000.0) % 3_600_000.0
    units = int(ms_past_hour / 3_600_000.0 * (2 ** 31))
    return (units * 2) & 0xFFFFFFFF


def build_orbit_espdu(args, t_s):
    """One ESPDU of an entity circling the anchor, encoded by open-dis."""
    def ecef_at(tt):
        ang = 2.0 * math.pi * tt / args.orbit_period
        north = args.radius * math.cos(ang)
        east = args.radius * math.sin(ang)
        lat = args.anchor_lat + north / M_PER_DEG_LAT
        lon = args.anchor_lon + east / (111319.5 * math.cos(math.radians(args.anchor_lat)))
        return GPS_CONV.lla2ecef([lat, lon, args.anchor_h + args.alt])

    p0 = ecef_at(t_s)
    p1 = ecef_at(t_s + 0.5)
    pdu = EntityStatePdu()
    pdu.protocolVersion = 6
    pdu.exerciseID = args.exercise
    pdu.timestamp = dis_timestamp_relative()
    pdu.entityID.simulationAddress.site = args.site
    pdu.entityID.simulationAddress.application = args.app
    pdu.entityID.entityNumber = args.entity
    pdu.forceId = 3  # neutral: an external range entity, neither side
    pdu.entityType.entityKind = 1
    pdu.entityType.domain = 2
    pdu.entityType.country = 0
    pdu.entityType.category = 50
    pdu.entityType.subcategory = 2
    pdu.marking.setString(args.marking)
    pdu.entityLocation.x, pdu.entityLocation.y, pdu.entityLocation.z = p0
    pdu.entityLinearVelocity.x = (p1[0] - p0[0]) / 0.5
    pdu.entityLinearVelocity.y = (p1[1] - p0[1]) / 0.5
    pdu.entityLinearVelocity.z = (p1[2] - p0[2]) / 0.5
    pdu.deadReckoningParameters.deadReckoningAlgorithm = 2  # FPW
    stream = BytesIO()
    pdu.serialize(DataOutputStream(stream))
    return stream.getvalue()


def run_send(args):
    args.anchor_lat, args.anchor_lon, args.anchor_h = parse_anchor(args.anchor)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    interval = 1.0 / args.rate
    print(f"SENDING to {args.dest}:{args.port} as {args.site}:{args.app}:{args.entity} "
          f"marking {args.marking!r}, {args.rate:.1f} Hz for {args.duration}s", flush=True)
    sent = 0
    started = time.monotonic()
    while time.monotonic() - started < args.duration:
        data = build_orbit_espdu(args, time.monotonic() - started)
        if len(data) != 144:
            raise SystemExit(f"open-dis serialized an ESPDU of {len(data)} B, expected 144")
        sock.sendto(data, (args.dest, args.port))
        sent += 1
        time.sleep(interval)
    sock.close()
    print(f"SENT {sent}", flush=True)
    return 0


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="mode", required=True)

    recv = sub.add_parser("receive", help="bind a UDP port and score the PDU stream")
    recv.add_argument("--port", type=int, required=True)
    recv.add_argument("--duration", type=float, default=20.0, help="seconds to listen (default 20)")
    recv.add_argument("--anchor", required=True, help="lat,lon[,h] of the sim anchor (decimal degrees, meters)")
    recv.add_argument("--exercise", type=int, default=1)
    recv.add_argument("--bind", default="0.0.0.0", help="local address to bind (default 0.0.0.0)")
    recv.add_argument("--exp-site", type=int, default=1, help="expected ESPDU site (default 1)")
    recv.add_argument("--exp-app", type=int, default=3001, help="expected ESPDU application (default 3001)")
    recv.add_argument("--max-offset-m", type=float, default=6000.0)
    recv.add_argument("--min-espdus", type=int, default=1)
    recv.add_argument("--linger", type=float, default=1.0, help="seconds to keep draining after Stop/Freeze Termination")
    recv.add_argument("--max-violation-lines", type=int, default=20)

    send = sub.add_parser("send", help="emit an open-dis-encoded ESPDU orbit")
    send.add_argument("--port", type=int, required=True)
    send.add_argument("--anchor", required=True, help="lat,lon[,h] of the sim anchor (decimal degrees, meters)")
    send.add_argument("--dest", default="127.0.0.1")
    send.add_argument("--site", type=int, default=3)
    send.add_argument("--app", type=int, default=5001)
    send.add_argument("--entity", type=int, default=1)
    send.add_argument("--exercise", type=int, default=1)
    send.add_argument("--marking", default="PY-EXT-1")
    send.add_argument("--duration", type=float, default=10.0)
    send.add_argument("--rate", type=float, default=2.0, help="ESPDUs per second (default 2)")
    send.add_argument("--radius", type=float, default=500.0, help="orbit radius around the anchor, meters")
    send.add_argument("--alt", type=float, default=120.0, help="altitude above the anchor, meters")
    send.add_argument("--orbit-period", type=float, default=60.0, help="seconds per revolution")

    args = parser.parse_args(argv)
    if args.mode == "receive":
        return run_receive(args)
    return run_send(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
