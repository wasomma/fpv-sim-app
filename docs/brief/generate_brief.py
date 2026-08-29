"""Generates docs/fpv-sim-vbs4-interop-brief.pdf, the shareable lab brief.

Reproducible source for the committed PDF: python docs/brief/generate_brief.py
(requires reportlab). Styling follows the OneArc palette so the document
reads comfortably alongside OneArc material, deliberately WITHOUT the
OneArc logo: this is a personal-project brief, not an official
publication, and it says so on page one.
"""

from pathlib import Path

from reportlab.graphics.shapes import Drawing, Line, Polygon, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

DARK = colors.HexColor("#3D4146")
DARK80 = colors.HexColor("#62686D")
BROWN = colors.HexColor("#6C6460")
LIGHT = colors.HexColor("#E9E4E1")
YELLOW = colors.HexColor("#FBBC33")
RULE = colors.HexColor("#E4E4E4")

OUT = Path(__file__).resolve().parents[1] / "fpv-sim-vbs4-interop-brief.pdf"
TITLE = "FPV Sim to VBS4: DIS interoperability brief"

body = ParagraphStyle("body", fontName="Helvetica", fontSize=9.2, leading=13.2, textColor=DARK)
kicker = ParagraphStyle("kicker", parent=body, fontSize=8.2, textColor=BROWN)
title_st = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=19, leading=23, textColor=DARK)
h2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11.5, leading=14, textColor=DARK, spaceBefore=10)
small = ParagraphStyle("small", parent=body, fontSize=7.8, leading=10.6, textColor=DARK80)
cell = ParagraphStyle("cell", parent=body, fontSize=8.2, leading=11.2)
cell_b = ParagraphStyle("cellb", parent=cell, fontName="Helvetica-Bold")


def yellow_rule(width=26 * mm):
    d = Drawing(width, 3)
    d.add(Rect(0, 0, width, 2.6, fillColor=YELLOW, strokeColor=None))
    return d


def para(text, style=body):
    return Paragraph(text, style)


def box(d, x, y, w, h, label_lines, fill=colors.white, stroke=DARK, bold=False, text=None, size=7.6):
    d.add(Rect(x, y, w, h, fillColor=fill, strokeColor=stroke, strokeWidth=0.9, rx=2, ry=2))
    text_color = text if text is not None else DARK
    font = "Helvetica-Bold" if bold else "Helvetica"
    total = len(label_lines)
    for i, line in enumerate(label_lines):
        cy = y + h / 2 + (total - 1) * 4.6 / 2 - i * 9.2
        d.add(String(x + w / 2, cy - 2.6, line, fontName=font, fontSize=size, fillColor=text_color, textAnchor="middle"))


def arrow(d, x1, y1, x2, y2, label=None, label_dy=4, color=DARK):
    d.add(Line(x1, y1, x2, y2, strokeColor=color, strokeWidth=1.1))
    import math

    ang = math.atan2(y2 - y1, x2 - x1)
    for s in (1,):
        ax, ay = x2, y2
        p = Polygon(
            [
                ax,
                ay,
                ax - 6 * math.cos(ang - 0.42), ay - 6 * math.sin(ang - 0.42),
                ax - 6 * math.cos(ang + 0.42), ay - 6 * math.sin(ang + 0.42),
            ],
            fillColor=color,
            strokeColor=None,
        )
        d.add(p)
    if label:
        d.add(
            String((x1 + x2) / 2, max(y1, y2) + label_dy, label, fontName="Helvetica", fontSize=6.8, fillColor=DARK80, textAnchor="middle")
        )


def architecture():
    d = Drawing(500, 252)
    # App container
    d.add(Rect(0, 32, 236, 214, fillColor=colors.HexColor("#F9F8F7"), strokeColor=DARK, strokeWidth=1.1, rx=3, ry=3))
    d.add(String(10, 230, "FPV Sim desktop app (Windows, offline, installable)", fontName="Helvetica-Bold", fontSize=8.4, fillColor=DARK))
    box(d, 10, 198, 216, 24, ["Sim, dashboard, WebGPU 3D viewer", "(unmodified upstream pages)"], fill=colors.white)
    box(d, 10, 168, 104, 24, ["Engine", "(golden-master parity)"], fill=LIGHT)
    box(d, 122, 168, 104, 24, ["Monte Carlo", "runners"], fill=colors.white)
    box(d, 10, 138, 104, 24, ["MCP endpoint", "(Claude, agents)"], fill=colors.white)
    box(d, 122, 138, 104, 24, ["Live session host", "(wall-clock paced)"], fill=colors.white)
    box(d, 10, 96, 216, 32, ["DIS gateway (IEEE 1278.1 over UDP)", "publish + receive-as-overlay"], fill=DARK, text=colors.white, bold=True, size=8.0)
    d.add(String(118, 82, "configurable geo anchor: local 4 x 4 km frame to WGS-84", fontName="Helvetica", fontSize=6.8, fillColor=DARK80, textAnchor="middle"))

    # Direct DIS path to VBS4
    box(d, 306, 188, 84, 30, ["VBS Gateway", "(ships with VBS4)"], fill=colors.white)
    box(d, 416, 188, 84, 30, ["VBS4", "whole-earth 3D"], fill=LIGHT, bold=True, size=8.0)
    arrow(d, 236, 118, 306, 203)
    arrow(d, 390, 203, 416, 203)

    # Bridged HLA path
    box(d, 306, 114, 84, 30, ["Pitch DIS", "Adapter"], fill=colors.white)
    box(d, 416, 108, 84, 38, ["Pitch pRTI:", "HLA federation", "(RPR-FOM 2.0)"], fill=colors.white, size=7.0)
    arrow(d, 236, 108, 306, 129)
    arrow(d, 390, 129, 416, 129)

    # Reverse path (inbound overlay), dashed
    d.add(Line(306, 196, 240, 106, strokeColor=DARK80, strokeWidth=1.0, strokeDashArray=[3, 2]))
    arrow(d, 244, 111, 238, 103, color=DARK80)

    # dis-listen
    box(d, 306, 44, 84, 26, ["dis-listen CLI", "(dry-run monitor)"], fill=colors.white)
    arrow(d, 236, 98, 306, 57, color=DARK80)

    # Legend strip (replaces corridor labels: the arrow fan stays clean)
    d.add(String(0, 14, "Outbound DIS: Entity State, EM Emission, Detonation, Fire (optional), Start/Resume, Stop/Freeze.", fontName="Helvetica", fontSize=6.9, fillColor=DARK80))
    d.add(String(0, 4, "Inbound (dashed): external Entity State PDUs render as a read-only overlay; nothing from the network reaches the engine.", fontName="Helvetica", fontSize=6.9, fillColor=DARK80))
    return d


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.7)
    canvas.line(18 * mm, 14 * mm, A4[0] - 18 * mm, 14 * mm)
    canvas.setFont("Helvetica", 7.2)
    canvas.setFillColor(DARK80)
    canvas.drawString(18 * mm, 10 * mm, TITLE)
    canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"page {doc.page} of 3")
    canvas.restoreState()


def pdu_table():
    rows = [
        [para("PDU", cell_b), para("When it goes out", cell_b), para("Key choices", cell_b)],
        [
            para("Entity State", cell),
            para("first sighting, dead-reckoning threshold trips (2 m or 3 degrees against a DRM mirror), 5 s heartbeat, appearance changes, final state at death", cell),
            para("statics DRM 1, drones DRM 2 (FPW) by default. Wrecks keep heartbeating with destroyed appearance (plus a 60 s flaming window on kills) until session stop. Markings: B-GCS, O-sUAS-3", cell),
        ],
        [
            para("EM Emission", cell),
            para("every keyed to unkeyed edge of the GCS C2 uplink and each drone video downlink, 10 s heartbeat while keyed, zero-beam EE at unkey", cell),
            para("one omni beam per emitter. RF values are notional config (uplink 915 MHz, video 5.8 GHz): the engine models keying, not a link budget. The EMCON duty cycles that decide the fight are visible on the wire", cell),
        ],
        [
            para("Detonation", cell),
            para("the tick a one-way FPV impacts", cell),
            para("GCS kill: Entity Impact with the target ID. Objective strike: Ground Impact. The airframe is the munition. Order: killer's final ESPDU, then Detonation, then the target's destroyed ESPDU", cell),
        ],
        [
            para("Fire", cell),
            para("off by default (config)", cell),
            para("a one-way FPV has no separate launch event, the Detonation stands alone. Enable for consumers that pair Fire with Detonation", cell),
        ],
        [
            para("Start/Resume, Stop/Freeze", cell),
            para("session start announce, pause (Recess) and resume; stop sends nothing unless the end-VBS-mission option is set (Termination)", cell),
            para("Real-World Time zero, meaning immediate action, which VBS Gateway honors. Received sim-management PDUs are logged, never obeyed", cell),
        ],
    ]
    t = Table(rows, colWidths=[26 * mm, 62 * mm, 86 * mm], repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, 0), 1.2, YELLOW),
                ("LINEBELOW", (0, 1), (-1, -2), 0.5, RULE),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return t


def steps_table():
    steps = [
        ("0", "Dry run without VBS", "npm run dis-listen -- --port=3000 --mode=broadcast on any second machine. Expect one Start/Resume, six ESPDUs immediately then drones on launch, EE lines flipping with the EMCON schedule, exactly one Detonation at the kill, no malformed lines. Wireshark's DIS dissector should show a clean capture."),
        ("1", "VBS Gateway configuration", "DIS adapter only (never DIS and HLA adapters together, a documented VBS limitation). Match DIS version (6), exercise ID (1), UDP port (3000), and the broadcast or multicast scheme. Geofilter off or enclosing the anchor box."),
        ("2", "Terrain correlation (the better demo)", "npm run terrain-export -- --seed=N --lat=.. --lon=.. and import the elevation .asc (with .prj) via VBS Geo at the same coordinates. Set water level to elevation 0 (negative posts are real seabed). Verify three grid references before flying."),
        ("3", "Entity mapping", "confirm VBS Gateway resolves the four enumerations to visible models (defaults are generic surrogates chosen for fuzzy mapping), remap per site on either side, record the mapping."),
        ("4", "Live engagement at 1x", "six entities at correct grid refs, then eight after launches. Drones smooth (tune thresholds or switch DRM 2 to 4 if rubber-banding). EE systems listed in the Gateway UI while keyed. Detonation effect at the kill, wreck persists. Pause and resume from the app freezes and resumes VBS-side entities. Then a 4x pass: entities 4x faster, still smooth."),
        ("5", "Reverse path", "place a VBS4 entity inside the box: it appears in the app's Live Ops overlay within about 5 s, extrapolates smoothly, expires about 12 s after deletion. The engagement itself is untouched (the overlay is display-only by construction)."),
        ("6", "Capture tuned values", "feed threshold or enumeration adjustments back into the config defaults and archive a reference capture."),
    ]
    rows = []
    for n, lead, text in steps:
        rows.append([para(n, ParagraphStyle("n", parent=cell_b, textColor=DARK)), para(f"<b>{lead}.</b> {text}", cell)])
    t = Table(rows, colWidths=[8 * mm, 166 * mm])
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BACKGROUND", (0, 0), (0, -1), LIGHT),
                ("LINEBELOW", (0, 0), (-1, -2), 0.5, RULE),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return t


def links_table():
    rows = [
        [para("Application", cell_b), para("fpv-sim-app v0.1.0, installer fpv-sim-app-setup-0.1.0.exe (unsigned, SmartScreen warns). github.com/wasomma/fpv-sim-app (private): docs/INTEROP.md, docs/VBS4_CHECKLIST.md", cell)],
        [para("Simulation", cell_b), para("fpv-sim v1.5.0 (UI pin 7050617): the engagement model, Monte Carlo evidence, dashboard, 3D viewer. github.com/wasomma/fpv-sim", cell)],
        [para("Engine", cell_b), para("fpv-sim-mcp v0.3.0 (pin f848528): the golden-master verified TypeScript port plus MCP tools. github.com/wasomma/fpv-sim-mcp", cell)],
        [para("Verification", cell_b), para("58 automated tests plus an 8-step in-app self-check (including a DIS loopback session) on every commit, and against the packaged build. A live session run to its end reproduces the batch result byte for byte.", cell)],
    ]
    t = Table(rows, colWidths=[26 * mm, 148 * mm])
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, -2), 0.5, RULE),
                ("TOPPADDING", (0, 0), (-1, -1), 3.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    return t


doc = BaseDocTemplate(
    str(OUT),
    pagesize=A4,
    leftMargin=18 * mm,
    rightMargin=18 * mm,
    topMargin=16 * mm,
    bottomMargin=20 * mm,
    title=TITLE,
    author="Wes Fine",
    subject="Personal project brief: streaming a deterministic FPV engagement simulation into VBS4 over DIS",
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=footer)])

story = [
    para("Personal technical brief, 29 August 2026", kicker),
    Spacer(1, 2),
    para(TITLE, title_st),
    Spacer(1, 4),
    yellow_rule(),
    Spacer(1, 6),
    para(
        "Personal project by Wes Fine. Not an official BAE Systems OneArc publication; VBS4, VBS Gateway and the "
        "Pitch products are referenced as interoperability targets. All simulation data is notional and unclassified.",
        small,
    ),
    Spacer(1, 10),
    para("What this is", h2),
    para(
        "FPV Sim models a force-on-force engagement: two sides each field armed FPV quadcopters, passive RF "
        "direction-finding nodes, and a ground control station (the target). The sides hunt each other's GCS by its "
        "RF emissions, so emission discipline (EMCON) decides the fight. The model is deterministic by construction "
        "(the same seed always replays the identical engagement), which is what makes its Monte Carlo evidence and "
        "its golden-master verification chain possible. It now ships as an installable, fully offline Windows "
        "application that runs everything locally: the interactive sim, the studies and dashboard, an MCP endpoint "
        "for agent control, and a native DIS gateway that streams live engagements to external simulators.",
    ),
    Spacer(1, 6),
    para(
        "The demo: start a live, wall-clock-paced engagement in the app (from the UI, or by asking Claude through "
        "MCP), and VBS4, connected over DIS through its standard VBS Gateway, renders the airframes, ground "
        "stations, emissions and strikes on correlated terrain. External DIS entities appear back in the app as a "
        "read-only overlay that can never influence the engagement.",
    ),
    Spacer(1, 12),
    para("Architecture", h2),
    Spacer(1, 4),
    architecture(),
    PageBreak(),
    para("What goes on the wire", h2),
    Spacer(1, 4),
    pdu_table(),
    Spacer(1, 6),
    para(
        "Protocol version 6 by default (7 available), receive accepts 4 to 7. Timestamps relative by default. "
        "Worst-case rate at real time: roughly 25 to 30 PDUs per second, under 5 kB/s.",
        small,
    ),
    para("Time across the DIS boundary", h2),
    para(
        "DIS has no time-scale message, so no peer can be commanded to a speed, and none needs to be. At "
        "accelerated session speeds the gateway publishes wall-apparent kinematics: velocity and angular-rate "
        "fields scale by the speed factor (attitude stays physical), and every speed change fires a full Entity "
        "State refresh volley. Receivers extrapolate in wall time, so VBS4 renders the engagement at the app's "
        "chosen speed with correct smoothing, its own clock untouched. Pause and resume travel as Stop/Freeze "
        "(Recess) and Start/Resume with immediate-action semantics. An advisory ceiling of 8x mirrors VBS's own "
        "documented smoothing limits under accelerated time.",
    ),
    para("Terrain and georeferencing", h2),
    para(
        "A configured anchor (latitude, longitude, height of sim sea level, grid azimuth) places the sim's 4 x 4 km "
        "procedural terrain on Earth; entity positions and the DEM export share one mapping, so they cannot "
        "disagree. The terrain-export tool writes any seed's heightfield as a georeferenced Esri ASCII Grid with a "
        "UTM projection file, plus a canopy-density raster, for import through VBS Geo. Set the VBS water level to "
        "elevation 0: negative posts are real seabed, and the coastline then renders where the engagement thinks "
        "it is.",
    ),
    para("Two guarantees worth knowing", h2),
    para(
        "Determinism: a live session that runs to its end produces a result byte-identical to the batch run of the "
        "same seed, mode and configuration (enforced in CI on every commit). Isolation: received DIS traffic feeds "
        "a display-only overlay; there is no code path from the network into the engine.",
    ),
    PageBreak(),
    para("Lab procedure (condensed from docs/VBS4_CHECKLIST.md)", h2),
    Spacer(1, 4),
    steps_table(),
    Spacer(1, 10),
    para("Versions and links", h2),
    Spacer(1, 2),
    links_table(),
    Spacer(1, 10),
    para(
        "Contact: Wes Fine (wasomma@gmail.com). Repository access on request while the project is private.",
        small,
    ),
]

doc.build(story)
print(f"wrote {OUT}")
