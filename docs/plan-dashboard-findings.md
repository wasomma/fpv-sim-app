# Dashboard refactor: findings first

Status: APPROVED 2026-09-12; PR 1 open as wasomma/fpv-sim#32 (f73ccb7); PR 2 built on branch claude/dashboard-findings-app (submodule at f73ccb7 until PR 1 merges, then re-point at the merge sha and regenerate figures).


## Context

Wes's concern (2026-09-12): the results Dashboard is data-overloaded and the simple,
clear findings of a study are hard to extract.

What the Dashboard is today (verified from figures + manual ch. 7 + upstream CLAUDE.md):

- `dashboard.html` is an upstream fpv-sim page (submodule pin `7050617` = fpv-sim main
  today), single-file, served byte-identical by this app at `app://ui/dashboard.html`
  and publicly at `wasomma.github.io/fpv-sim/dashboard.html`. This repo may not edit it
  (`npm run check-pins` gates CI). A change to the page itself is a fpv-sim PR followed by
  a paired pin bump here; a new findings surface can instead live in `src/renderer/`.
- Page = header (SHOW filter, DATASET select, OPEN SIMULATION, READ THE STUDY) →
  4–5 KPI tiles (BLUFOR / OPFOR / STALEMATE win rates with Wilson 95% CI, decisive share,
  tactical strikes) → Dose response (studies only) → Paired comparisons (studies only) →
  Baseline timelines (3 histograms) → Notable engagements (WATCH links) → Provenance footer.
  Each chart card carries a collapsed TABLE VIEW.
- The manifest `results/index.json` already carries per-dataset `baseline.win_rates`,
  `overrides`, `mode`, `kind`, `label`, `total_runs`, commits.
- The actual "findings" of the canonical study are written in prose in upstream
  `MONTE_CARLO.md` (headline bullets: 48.0 vs 28.1, discipline worth ~13 pts, stagger worth
  nothing, dose-dependent, replicates in tactical, reserve hunter is the biggest tactical
  lever). None of that prose is on the page; the manual (07-dashboard.md §7.2 step 4) asks
  the *reader* to compose "the comparison sentence" by switching datasets and remembering
  numbers.
- For an ad-hoc sweep the page shows tiles for that sweep alone: no delta against the
  stock baseline, although the baseline numbers sit in the same manifest.

Sibling checkouts on this PC: `Desktop\Dev\Projects\fpv-sim` (main = 7050617, clean) and
`fpv-sim-mcp` (main = f848528, clean). No open issues or PRs on any of the three repos.

## Exploration facts that shape the design (2026-09-12)

- `dashboard.html`: 546 lines, one file, 423 lines of vanilla JS, hand-rolled SVG, no
  library, no query params, no URL/local state. Render fns: `renderTiles` :233, `renderDose`
  :266, `renderPaired` :320 (dumbbell kit reusable), `renderHistograms` :386, `renderSeeds`
  :433, `renderProvenance` :462; manifest fetch :502, dataset fetch :486, selector :511–540.
- The page computes almost nothing: only decisive share (:237) and paired delta (:362). All
  CIs (Wilson), histograms, notable seeds come precomputed from `scripts/sweep-utils.mjs`
  and the engine's `aggregateSweep`.
- Dataset JSON carries far more than the page shows, all unused: `time_to_fix_s` /
  `time_to_kill_s` / `duration_s` `{mean,median,p10,p90,min,max,n}`, `stalemate_reasons`,
  `paired.{blufor,opfor,stalemate}_win_rate_delta`, `paired.mean_time_to_fix_delta_s`,
  `paired.flips_sample`. No per-run records exist anywhere (42 kB for 22,800 runs).
- Manifest `results/index.json` already holds `baseline.{runs,win_rates}` for every dataset
  → an ad-hoc sweep's delta vs the stock study is computable from the manifest alone.
- The only prose-verdict generator in the codebase is `comparisonSummary()` in fpv-sim-mcp
  `dist/src/server/summary.js:12-35` (MCP `compare_configs` only; |Δ|<0.02 = "no meaningful
  difference"). Never persisted.
- App side: panels cannot `fetch` `app://ui/results/*` (origin + CSP); they use IPC. No IPC
  returns a dataset body today; `results-list` returns manifest entries (incl. `baseline`)
  + sizes. Studies panel renders no result numbers at all. `openWindow("dashboard")` sends
  no dataset identity; a finished run relies on "newest loads first" + full window reload.
- Screenshot harness (`src/main/screenshots.ts:472–557`) depends on DOM hooks `#status`,
  `#content`, `#charts .card[h2,svg,circle]`, `#tiles`, `#seedsCard`, `#prov`, `#dataset`,
  `#kindFilter`, `#tooltip`, header ancestor. 14 dashboard + 6 studies figures are CI-gated.
- Manual `07-dashboard.md` carries the interpretation the UI lacks (§7.2 step 4 "the
  comparison sentence", §7.6 Row/Change/Headline table).
- A dashboard-only upstream change does not touch `index.html`, so `check-pins` passes on a
  submodule bump without an engine bump (the pair rule guards parity, which is unaffected).

## Strawman: "Findings first, evidence on demand"

Diagnosis: the page is not too much data so much as no finding. Every card is evidence;
the verdict lives in prose the page never shows, and for ad-hoc sweeps there is no
reference point at all.

Three layers on the upstream `dashboard.html` (fpv-sim PR, then pin bump here):

1. FINDING (always open, above the fold)
   - Verdict sentence, auto-generated deterministically from the dataset (no stored prose).
     Study: baseline rates + decisive share + one clause per paired experiment (from
     `paired.*_delta`) + the dose-sweep endpoints. Ad-hoc: this sweep vs the stock study of
     the same mode (from the manifest's `baseline.win_rates`), three deltas with a
     significance word from the 95% CI of the difference (Newcombe), decisive split vs
     baseline.
   - The existing tile row under it (ad-hoc tiles gain a Δ-vs-baseline line; Decision 8).
2. KEY EVIDENCE (one card open)
   - Study: paired comparisons (the levers). Ad-hoc: a new 3-row "vs baseline" dumbbell
     built with the existing `renderPaired` kit (hollow = stock study, filled = this sweep).
3. ALL EVIDENCE (one collapsed `<details>`): dose response, histograms, notable
   engagements, table views, provenance — today's cards unchanged.

Same upstream PR: `?dataset=<file>` deep link (drafted proposal). App follow-up: Studies
LAST DATASET box and DATASETS rows show B/O/S (+Δ vs baseline) from the manifest and an
OPEN link carrying `?dataset=`; manual ch. 7 rewritten; figures + harness hooks updated.

Rejected alternative: an app-owned Findings panel (new IPC dataset reader, duplicated
tile/chart kit, public GitHub Pages dashboard stays overloaded, two surfaces to document).

## Decisions (Wes, 2026-09-12; all recommended defaults accepted)

1. Home: upstream `dashboard.html` in the fpv-sim repo, then submodule pin bump here.
2. `?dataset=<file>` deep link in the same upstream PR; Studies panel consumers in the app PR.
3. Audience: first-time viewer; plain-English verdict with the numbers inline.
4. Ad-hoc reference = the canonical study of the same mode found in the manifest
   (kind=study, matching mode); degrade gracefully when absent.
5. Verdict auto-generated from the data, deterministic, nothing stored.
6. Significance: 95% CI of the difference (Newcombe). Excludes 0 → "clear"; includes 0 but
   |Δ| ≥ 2 pts → "slight"; else "no measurable difference".
7. Study key evidence: paired comparisons open; dose response collapsed.
8. Tiles stay under the verdict; ad-hoc tiles gain a Δ-vs-baseline line.
9. Detail hidden in one collapsed ALL EVIDENCE `<details>`; cards unchanged inside it.
10. COPY FINDINGS button: verdict + tiles + deltas + provenance as Markdown to clipboard.
11. No arbitrary A-vs-B compare in this refactor.

## Implementation plan

Two PRs in order. PR 1 in `Desktop\Dev\Projects\fpv-sim` (branch off main 7050617; only
`dashboard.html` + docs change; no runner script changes). PR 2 in this repo after PR 1
merges (submodule bump + consumers + harness + manual). Line anchors are to the current
files; apply by function name.

### PR 1 — fpv-sim: `dashboard.html` three-layer restructure

**Markup** (replace body L106-118; header L91-105 and `#tooltip` L119 unchanged):
```
#status
#content[hidden]
  section.card.finding#finding
    .head  h2 "Finding"  button#copyBtn "COPY FINDINGS"
    .sub   "Generated from this dataset — every number below also appears in the cards that follow."
    #verdict                           ← p.lead > b · ul.clauses > li · p.note (caveat)
    .tiles#tiles                       ← same id, moved inside the finding card
  #charts                              ← now a static wrapper (harness queries `#charts .card`)
    #key                               ← study: paired card · ad-hoc: VS STOCK BASELINE card
    details#evidence.evidence[closed]
      summary "All evidence — charts, notable engagements, provenance"
      #more                            ← dose response, histograms
      .card#seedsCard (as today)
      footer#prov (as today)
```
New card titles must not match the harness regexes `/dose/i`, `/paired/i`,
`/timeline|histogram|distribution/i`. Ad-hoc key card title: "Vs stock baseline — this
sweep against the stock study".

**CSS** (+~32 lines after L86): `.finding`, `.finding .head`, `.finding button[data-state]`,
`.finding .verdict` (14px, 1.65 lh, max-width 78ch, `--bright`), `.tile .delta` +
`.delta .word`, `details.evidence>summary` styled like the existing `details.tbl` summary
at card scale (▸/▾ marker). Chart colours untouched.

**Pure stats block** `/* @stats-begin */ … /* @stats-end */` (replaces `pct`/`fmtS` L140-144;
absorbs `modeOf` L231 and `kindOf`/`labelOf` L513-514; no DOM access inside):
- `rateT(v) = Math.round(v*1000)`, `dTenths(a,b)`, `dStr(dT)` → `+x.x` / `−x.x` (U+2212),
  `moveVerb(dT)` — the displayed-rate delta rule (see Reconciliation).
- `wilson(x, n)` — counts in, same math and signature as `scripts/sweep-utils.mjs:37-45`,
  z = 1.96, clamp to [0,1]. null when n=0.
- `newcombe(x1,n1,x2,n2)` — hybrid score (method 10), index 1 = arm described:
  `lo = Δ − √((p1−l1)² + (u2−p2)²)`, `hi = Δ + √((u1−p1)² + (p2−l2)²)`.
- `sigWord(ci, dT)` — `lo>0 || hi<0` → "clear"; `|dT| ≥ 20` → "slight"; else
  "no measurable difference"; null ci → "n/a".
- `cleanLabel(label)` → `{short, full}` (sanitise, truncate, see Reconciliation) and an
  `esc()` for HTML; Markdown/shell escaping inside `findingsMarkdown`/`regenCommand`.
- `refEntryFor(manifest, entry)` — ad-hoc only: newest manifest entry with kind=study and
  same mode (manifest is newest-first). null otherwise.
- `regenCommand(data)` — lifted from `renderProvenance` L476-479, output text identical.
- `deriveFacts(data, entry, refEntry)` → `{file,label,kind,mode,adhoc,tactical,meta…,n,
  rates{B,O,S:{p,lo,hi,count}}, decisive{share,count}, strikes|null, ttf{B,O medians},
  ref|null:{file,label,n,rates (wilson from manifest rates),deltas{B,O,S,decisive:{delta,lo,
  hi,sig}}}, refMissing, paired|null:[{key,name,n,flips,B,O,S:{a,b,delta,lo,hi,sig}}],
  regen, deepLink}`. Decisive delta uses exact counts on this side and
  `n2 ≈ round((refB+refO)·ref.n)` (3-dp manifest rates; comment it). Strikes tile: no Δ.
- `sentencesFor(facts)` → `{lead, clauses[], caveat}` per the wording spec (below); whole
  generator wrapped in try/catch (fail soft: hide `#finding`, still draw everything else).
- `findingsMarkdown(facts, text)` → Markdown per the wording spec.
- `verdict(data, manifest, entry)` → `{text, facts}`.

**Rendering changes:**
- `chartCard(title, subtitle, mount)` (L178) — mount param replaces the hard-coded `#charts`;
  `renderDose(data, mount)` L266, `renderPaired(data, mount)` L320,
  `renderHistograms(data, mount)` L386.
- New `dumbbell(card, rows, opts)` — lift L340-375 of `renderPaired` verbatim
  (`rows: [{group,label,color,a,b,tip}]`, `opts {labelW,xmax,ticks,xlabel}`);
  `renderPaired` calls it with `{labelW:330, xmax:0.45, ticks:[0,.1,.2,.3,.4], xlabel:"win
  rate"}` so its pixels are unchanged.
- New `renderVsBaseline(facts, mount)` — 3 rows BLUFOR/OPFOR/STALEMATE, hollow = stock
  study rate, filled = this sweep, Δ printed, tooltip with both CIs + n, dynamic `xmax`
  (stalemates reach 0.71), legend, `tableView` with columns Outcome | Stock | This sweep |
  Δ (points) | 95% CI of Δ | Reads as. When `!facts.ref`: card with subtitle "No stock
  baseline in this manifest — run the study for this mode to enable the comparison", no svg.
- New `renderFinding(data, facts, text)` — `#verdict` = `p.lead > b` (text.lead),
  `ul.clauses > li` per clause, `p.note` caveat; all via `textContent`/escaped; significance
  words wrapped in a `span.sig` with the `hoverable()` tooltip; then `renderTiles(data, facts)`.
- `renderTiles(data, facts)` (L233-264) — unchanged tiles; when `facts.ref`, tiles 0-3 get
  `div.delta` "Δ vs stock ±x.x pts <span.word>{sig}</span>". ("pts" is allowed in compact
  UI — tile lines, table cells, the Studies panel — never in the verdict prose.)
- `renderProvenance` (L462-482) — use `regenCommand(data)`; text byte-identical so the
  harness's `DASH_PROV_HAS` checks hold.
- COPY handler bound once in `init`: `navigator.clipboard.writeText(findingsMarkdown(...))`,
  button text COPIED / COPY FAILED with `data-state`, resets after 1.6 s; try/catch so
  file:// or a denied clipboard never throws.
- `loadDataset(entry, manifest)` (L485-497) — fetch with `res.ok` check and a status
  message on failure; status message when `experiments.baseline` is missing (today: uncaught
  TypeError, page stuck on "Loading…"); clears `#key` and `#more` (not `#charts`); sets
  module-level `current = {facts, sentences}`; `renderFinding`; key = `renderVsBaseline` for
  ad-hoc else `renderPaired`; `renderDose`/`renderHistograms` into `#more`; `renderSeeds`;
  `renderProvenance`.
- `init` (L499-542) — `readParam()` / `syncParam(file)` via `URLSearchParams` +
  `history.replaceState` (try/catch). On load: `wanted = manifest entry whose file ===
  ?dataset`; if wanted is hidden by a restored `#kindFilter`, force the filter to `all`;
  `applyFilter(preferFile)` picks `list.find(file===prefer) || list[0]` and sets
  `sel.value`. URL is rewritten only on user changes (select or filter), never on initial
  load, so the bare URL keeps meaning "newest". Add `autocomplete="off"` to both selects.

**Edge cases:** legacy entries without kind/mode/label (helpers default them; a legacy
entry is an eligible orbit reference); ad-hoc with no same-mode study (`refMissing`);
tactical study (5th tile, `reserveVsRetask`, `&mode=tactical` on WATCH untouched); tactical
ad-hoc (ref = tactical study; strikes tile no Δ); rate 0 or 1 (Wilson never degenerates;
`newcombe(50,50,0,50)` → [0.899, 1]); n=0 → null → "n/a"; unknown `?dataset=` → newest,
silent; several studies of one mode → newest wins.

**Docs in PR 1:** CHANGELOG `[Unreleased]` Added ("Dashboard finding layer and `?dataset=`
deep link…") and Changed ("Dashboard layout… DOM hooks unchanged: …"); CLAUDE.md
dashboard bullet (three layers, `?dataset=`, `@stats-begin/end` block, the app harness's
id/regex contract); README L229-231 sentence; MONTE_CARLO.md deep-link sentence and a
Newcombe note in the Uncertainty bullet.

**Test in PR 1:** `scripts/check-dashboard-stats.mjs` (~70 lines, zero deps): regex-extract
the stats block, evaluate with `new Function` (fails if it touches the DOM), compare
`wilson`/`newcombe` against an inline re-implementation over an (x,n) grid, assert check
values (tolerance 5e-5):
| call | Δ | lo | hi | word |
|---|---|---|---|---|
| newcombe(146,1000, 4800,10000) | −0.334 | −0.35675 | −0.30878 | clear |
| newcombe(719,2000, 977,2000) | −0.129 | −0.15917 | −0.09849 | clear |
| newcombe(197,400, 183,400) | +0.035 | −0.03407 | +0.10360 | slight |
| newcombe(971,2000, 977,2000) | −0.003 | −0.03395 | +0.02795 | no measurable difference |
| newcombe(0,50, 0,50) | 0 | −0.07135 | +0.07135 | no measurable difference |
| newcombe(50,50, 0,50) | 1 | 0.8991 | 1 | clear |
`wilson(4801,10000)` = (0.47031728, 0.48989800) and every `ci95` in the three committed
files reproduced to 4 dp; `wilson(2000,2000).hi` clamps to 1; delta rule values
`dTenths(0.4525,0.2790) = +174`, `dTenths(0.3595,0.4885) = −129`. Then the **golden-text
test**: `verdict` over each `results/index.json` entry must equal the three golden outputs
byte-for-byte (lead, clauses, caveat), and `findingsMarkdown` must contain the file name
and the regen command; ad-hoc `facts.ref.file === "monte-carlo.json"`. Wire it as `npm run check-dashboard` if fpv-sim has a package.json
script table, else document the `node scripts/…` invocation.

Size: dashboard.html ≈ +330 lines (546 → ~875). Commit subject: "Dashboard: finding layer,
vs-stock comparison for ad-hoc sweeps, ?dataset= deep link". Cut a fpv-sim version
(CHANGELOG-only + tag) after merge so the app's pin bump references a release.

### Reconciliation of the three designs (binding)

- Finding card `h2` = "Finding"; `.sub` = "Generated from this dataset — every number below
  also appears in the cards that follow." `#tiles` sits inside the card (Decision 8).
- `sentencesFor(facts)` returns `{lead, clauses: string[], caveat}`. Page: lead in
  `<p class="lead"><b>…</b></p>`, clauses as `<ul class="clauses">` one `<li>` per clause
  (scans faster than a 170-word paragraph; my call), caveat `<p class="note">`. Markdown:
  bold lead, then one `- ` bullet per clause. Same strings on both surfaces.
- Statistics take **counts**: `wilson(x, n)` (same signature as `sweep-utils.mjs`),
  `newcombe(x1, n1, x2, n2)`; index 1 = the arm being described, 2 = the reference.
  Reference counts for an ad-hoc dataset are reconstructed from the manifest:
  `Math.round(rate × runs)`; dose cells likewise from `cell.win_rates × cell.n`.
- **Displayed rates are always the file's `win_rates` / `ci95`; never recompute a CI for
  display** (recomputed 0.12546892 prints 12.5% where the file's 0.1255 prints 12.6%).
- **Deltas are integer tenths of displayed rates**: `dT = round(a·1000) − round(b·1000)`;
  print `(dT/10).toFixed(1)` with `+` / U+2212, "unchanged" when 0. Reproduces every
  `paired.*_delta` and the MONTE_CARLO.md tables; raw-float subtraction gives 17.3 vs the
  published +17.4. The 2-point "slight" test is on `|dT| ≥ 20`, so word and number never
  disagree. `fmtPts` is replaced by this rule. The app's `results-headline.ts` uses the
  same rule so panel and page agree.
- Decisive share of fights (verdict only) = `pct(1 − win_rates.STALEMATE)` so stalemate +
  decided = 100.0; "BLUFOR takes x% of the N decided fights" uses the counts (as the tile).
- **Escape the label** everywhere: `textContent` on the page (the existing footer at L467
  injects `data.label` into innerHTML — fix that too), `|`/backticks in Markdown, `"`/`\`
  in the regen command. Sanitise control chars, collapse whitespace, truncate > 60 chars
  at a word boundary ≥ 40 with "…", full label in `title`; empty → "unlabeled sweep".
- **Fail soft**: the generator runs inside try/catch; on error hide `#finding`,
  `console.warn`, and still draw tiles and cards.
- No parameter-default table in the page (a third copy of `params.ts` that drifts): print
  the flattened override paths and values only; never "6-second stagger" or "of 5".
- Word budget for the clauses: cap 260 words (alphanumeric tokens only; dashes and arrows are not words); if exceeded drop timing → dose → stagger in
  that order (orbit study 176, tactical 243, ad-hoc 84 — nothing drops today).
- One `hoverable()` tooltip on each significance word explaining the rule (text below).

### Wording spec (templates, conditions, golden outputs)

**Vocabulary.** Exactly three significance strings: `clear`, `slight`, `no measurable
difference`. Points are spelled "points" in prose (never "pts"/"%"). Banned: significant,
proves, demonstrates, optimal, real-world, should, recommend, any named real system, any
causal verb on an ad-hoc override. Approved causal verbs for paired arms only: moves,
costs, is worth, follows. Never "disciplined"/"continuous" for ad-hoc datasets.

**Formatting.** Rates `pct(v)` 1 dp; duty cycles `pct(v,0)`; counts `toLocaleString()`;
clock times `fmtS`; a gap < 120 s → "44 s", else `fmtS`; a rate of exactly 0 or 1 →
"0.0% (0 of 2,000)" / "100.0% (all 2,000)". After a verb print magnitude only ("falls
12.9 points"); `moveVerb(dT)` = falls / rises / is unchanged. Two deltas sharing a word →
"(both clear)" / "(no measurable difference either way)"; differing → tag each inline.

**Gates and interpretive tails (fire only on the stated condition):**
| clause | tail / rule | condition |
|---|---|---|
| paired (any) | emit | `variant.runs ≥ 100 && pairedStockArm.runs ≥ 100`; else one sentence "The paired experiments ran only {n} seeds each — too few to separate here; see the paired card." Missing key → skip silently |
| discipline parity | "— the two come within {g} points of each other" | wordB clear, dB<0, |vB−vO| < 5.0 |
| discipline parity | "— discipline is worth about {|dB|} points of win rate" | wordB clear, dB<0, gap ≥ 5.0 |
| discipline parity | "— nothing measurable changes" | all three words none |
| posture swap | "the advantage follows the posture, not the team: {winner} wins {pW} to {pL}" | wordB = wordO = clear, opposite signs, leading side flips |
| launch stagger | "is worth nothing — no rate moves more than {max} points" | all three none |
| launch stagger | "moves BLUFOR {dB} ({wB}) and OPFOR {dO} ({wO})" | otherwise |
| reserve (tactical) | "— the largest single effect in this battery" | its max |Δ| beats every other arm's |
| stalemate fragment | ", and stalemates {verbS} {|dS|}" | wordS clear and |dS| ≥ 3.0 |
| dose | standard sentence | ≥ 2 `continuous` cells with n ≥ 100 and last BLUFOR > first; else omit (never invert the lesson) |
| timing | standard sentence | both `time_to_fix_s[side].n ≥ 30` and gap ≥ 10 s |

**Lead (study)**, first match wins: (1) "Emissions posture, not the team, decides this
fight." when postureSwap B and O are both clear with opposite signs; (2) "Emissions
discipline is the deciding variable in this dataset." when parity BLUFOR delta is clear
and negative; (3) "{Leader} wins {pLead} to {pOther}; {pStale} end without a decision."

**Clauses (study, orbit)** in fixed order:
1. "Across {N} notional engagements on the stock configuration, BLUFOR (disciplined)
   wins {B}, OPFOR (continuous) {O}, and {S} end in stalemate, {reason}; BLUFOR takes
   {bShare} of the {nDecisive} decided fights." `{reason}`: sole key `both_drones_down` →
   "both drones down"; `packages_expended` → "both packages spent"; else omit.
2. "On {nPair} same-seed pairs (stock arm {sB} / {sO} / {sS}): give OPFOR the same duty
   cycles and BLUFOR {verbB} {|dB|} points to {vB} while OPFOR {verbO} {|dO|} to {vO}
   {tagBO}{parityTail}[, and stalemates {verbS} {|dS|}]." (the stock-arm bridge is
   required: 48.0 − 12.9 ≠ 36.0 without it)
3. "Swap the two postures outright and {swapTail} ({dO} / {dB}, {tagBO})."
4. "Equalizing the two sides' launch times {staggerClause}."
5. "It is a dial, not a switch: the more OPFOR transmits, the more BLUFOR wins:
   {doseFirst} → {doseLast} across the duty sweep ({dutyFirst} → {dutyLast} uplink duty,
   video continuous)."
6. "{fastSide} also locates the enemy station about {gap} sooner at the median ({mFast}
   vs {mSlow}), and reaches a fix at all in {nFixFast} of {N} runs to {slowSide}'s
   {nFixSlow}."
Caveat (always, dim): "All data is notional — a statement about this model, not about
any real system."

**Tactical study** adds after clause 1: "Both sides still land a mean {strikes} on the
objective, so the supported ground fight gets its fires either way and the duel is
decided at the margin." (`{strikes}` = "4.5 strikes each" when equal at 1 dp, else
"{B} / {O} strikes (BLUFOR / OPFOR)"; never "of 5"); and after clause 4: "Flying without
a dedicated hunter-killer — retasking a strike sortie onto the fix instead — costs both
sides: BLUFOR {dB}, OPFOR {dO}, stalemates {dS} ({tagAll}){largestTail}."

**Ad-hoc with same-mode study.** Lead: "'{label}': {B} / {O} / {S} — {leadWord} the stock
baseline." (`leadWord` from the largest-|Δ| outcome: clearly different from / slightly
different from / no measurable difference from). Clauses: (1) "Versus the stock baseline
({rB} / {rO} / {rS}), '{label}' moves BLUFOR {dB} points ({wB}), OPFOR {dO} ({wO}),
stalemates {dS} ({wS}); n={n} here vs n={rn} in the baseline." (2) "Only {dec} of fights
are decided against {rdec} there, and the decided ones split {split} here against
{rsplit} there." (integer splits; `nDecisive = 0` → "no decided fights"). (3) override
clause: 0 leaves → "No parameters were overridden — this is the stock configuration over
{n} seeds." (+ "It matches the baseline within sampling noise, as it should." when all
three none); 1 → "One parameter was changed: `{path}` = {value}."; 2–4 → "{k} parameters
were changed: …"; ≥ 5 → "…including `{p1}` = {v1}, `{p2}` = {v2} — the full set is in the
provenance footer below."; when ≥ 2 leaves add "These differences are the combined effect
of every change, not of any one of them." (4) optional timing clause (own counts only;
never compare fix rates across datasets).

**Ad-hoc with no same-mode study.** Lead "'{label}': {B} / {O} / {S} over {n}
engagements."; clause "There is no stock {mode} study in this results folder to compare
against, so these numbers stand alone: BLUFOR wins {B}, OPFOR {O}, and {S} end {reason};
{dec} of fights are decided and BLUFOR takes {bShare} of those."; override clause; "Run
`node scripts/monte-carlo-study.mjs{modeArg}` to produce a baseline to compare against."
Never fall back to the other mode's study.

**Degenerate:** `runs < 100` → prefix "Small sample — n={n}; treat everything below as
indicative only." and suppress dose + timing; all stalemates → "No engagement was
decided: all {n} runs ended {reason}." and suppress share/split/dose; dose cells all burst
→ omit dose clause.

**Tooltip on a significance word:** "How the word is chosen: the 95% confidence interval
for the difference between the two rates (Newcombe's hybrid Wilson method, z=1.96).
Excludes zero → clear. Includes zero but the gap is at least 2 points → slight. Otherwise
→ no measurable difference. The paired experiments rerun the same seeds and an ad-hoc
sweep usually reuses seeds from the baseline's range, so per-seed luck partly cancels and
this interval is wider than it needs to be — the word understates the evidence rather
than overstating it. Per-outcome Wilson CIs are on the tiles below."

**Golden outputs** (byte-identical for the committed datasets; the regression test):

Orbit study — lead "Emissions posture, not the team, decides this fight." Clauses:
> Across 10,000 notional engagements on the stock configuration, BLUFOR (disciplined) wins 48.0%, OPFOR (continuous) 28.1%, and 23.9% end in stalemate, both drones down; BLUFOR takes 63.0% of the 7,615 decided fights.
> On 2,000 same-seed pairs (stock arm 48.9% / 27.9% / 23.3%): give OPFOR the same duty cycles and BLUFOR falls 12.9 points to 36.0% while OPFOR rises 5.3 to 33.2% (both clear) — the two come within 2.8 points of each other, and stalemates rise 7.6.
> Swap the two postures outright and the advantage follows the posture, not the team: OPFOR wins 45.3% to BLUFOR's 31.8% (+17.4 / −17.1, both clear).
> Equalizing the two sides' launch times is worth nothing — no rate moves more than 0.3 points (no measurable difference either way).
> It is a dial, not a switch: the more OPFOR transmits, the more BLUFOR wins: 27.3% → 50.2% across the duty sweep (14% → 86% uplink duty, video continuous).
> BLUFOR also locates the enemy station about 44 s sooner at the median (6:14 vs 6:58), and reaches a fix at all in 6,795 of 10,000 runs to OPFOR's 3,180.

Tactical study — same lead; clause 1 with 29.7% / 18.5% / 51.9%, "both packages spent",
61.7% of the 4,812; strikes clause "4.5 strikes each"; parity "BLUFOR falls 8.4 points to
20.9% (clear) while OPFOR's 18.6% is within noise of its 18.8% (−0.2, no measurable
difference) — the two come within 2.3 points of each other, and stalemates rise 8.5.";
swap "OPFOR wins 28.9% to BLUFOR's 19.7% (+10.1 / −9.6, both clear)"; stagger "no rate
moves more than 1.5 points"; reserve "BLUFOR −14.4, OPFOR −12.8, stalemates +27.2 (all
clear) — the largest single effect in this battery."; dose "16.5% → 31.8%"; timing "about
91 s sooner at the median (2:51 vs 4:22), … 3,248 of 10,000 runs to OPFOR's 2,219."

Ad-hoc 8° — lead "'DF bearing error doubled (8 deg)': 14.6% / 14.4% / 71.0% — clearly
different from the stock baseline." Clauses:
> Versus the stock baseline (48.0% / 28.1% / 23.9%), 'DF bearing error doubled (8 deg)' moves BLUFOR −33.4 points (clear), OPFOR −13.7 (clear), stalemates +47.1 (clear); n=1,000 here vs n=10,000 in the baseline.
> Only 29.0% of fights are decided against 76.1% there, and the decided ones split 50/50 here against 63/37 there.
> One parameter was changed: `CUAS.BRG_SIGMA_DEG` = 8.
> BLUFOR still locates the enemy station about 5:34 sooner at the median (6:05 vs 11:38), on the 838 of 1,000 runs where it reached a fix at all.

**Newcombe check values** (points): ad-hoc B 146/1000 vs 4800/10000 → −33.4
[−35.67, −30.88] clear; O 144 vs 2810 → [−15.93, −11.23]; S 710 vs 2390 → [+44.09,
+49.95]; parity B 719/2000 vs 977/2000 → −12.9 [−15.92, −9.85] clear; stagger B 971 vs
977 → −0.3 [−3.39, +2.80] none; dose 197/400 vs 183/400 → +3.5 [−3.41, +10.36] slight.
`wilson(4801,10000)` = (0.47031728, 0.48989800) must reproduce every `ci95` in the three
files to 4 dp; `wilson(2000,2000).hi` must clamp to 1.

**COPY FINDINGS Markdown** (`##` heading so it nests in an issue; lead + bullets; Unicode
minus; backticks on paths/commands; no HTML):
```
## Finding — AD-HOC · DF bearing error doubled (8 deg) · orbit · n=1,000

**'DF bearing error doubled (8 deg)': 14.6% / 14.4% / 71.0% — clearly different from the stock baseline.**
- Versus the stock baseline (…) … (one bullet per clause)

| Outcome | Rate | 95% CI | Δ vs baseline |
|---|---|---|---|
| BLUFOR victory | 14.6% | 12.6% – 16.9% | −33.4 (clear) |
| OPFOR victory | 14.4% | 12.4% – 16.7% | −13.7 (clear) |
| Stalemate (both drones down) | 71.0% | 68.1% – 73.7% | +47.1 (clear) |

Deltas are percentage points against `monte-carlo.json` (Full study, orbit, n=10,000). 95% CIs are Wilson score intervals; a delta's word comes from the 95% CI for the difference (Newcombe hybrid-Wilson, z=1.96): excludes 0 → clear, includes 0 but ≥ 2 points → slight, otherwise no measurable difference. All data is notional and unclassified.

Source: `results/adhoc-….json` · generated 2026-08-24 · 1,000 engagements · sim `e597c83` · engine `0d7d1fa`
Regenerate: `node scripts/run-sweep.mjs --label "…" --start 1 --count 1000 --overrides '…'`
```
Study variant: the Δ column becomes `n`; a second table "Experiment (2,000 same-seed
pairs) | BLUFOR | OPFOR | Stalemate | Flips" with the stock arm row and one row per paired
arm ("36.0% (−12.9, clear)"); tactical adds the reserve row and `--mode tactical`; the
methods line adds "Paired arms share seeds, so that interval is conservative."

**Follow-up ticket for fpv-sim (not this PR):** have both runners write
`meta.baseline_config` (resolved stock config) and per-cell `outcomes` in
`uplinkDutySensitivity`, so a future finding can name the stock value beside an override
and stop reconstructing counts.

### PR 2 — fpv-sim-app: pin bump, Studies consumers, harness, manual

Facts that shape it: `build/resources/` is untracked (pins file regenerated by `npm run
vendor` in CI), so the commit is submodule pointer + code + tests + docs + figures +
`images/manifest.json`. `check-pins.mjs:62-84` only needs the fixtures' source commit to be
an ancestor and `index.html` unchanged → engine pin `f848528` stays. `history.replaceState`
fires `did-navigate-in-page`, not `will-navigate`, so `applyNavPolicy` is untouched;
`uiKindForUrl`/`titleForUiUrl` key on pathname. `webContents.reload()` keeps the query.
`rendererRoot()` serves only `src/renderer/`, so shared pure code for the panel lives
main-side (pattern: `src/main/status-strip.ts` → IPC), not under `src/shared/`.

**Step 0 — confirm against the landed page** (before any harness work): `#finding` text
contains the dataset label; the ad-hoc key card `h2` matches `/vs stock/i`; cards inside
`#evidence` are built eagerly (only hidden); reference rule = newest same-mode study;
Δ formatting (U+2212, 1 decimal, "pts") so the panel's numbers match the page's.

**Step 1 — pin bump:** `git -C upstream/fpv-sim fetch origin && git -C upstream/fpv-sim
checkout <sha>` → `npm run vendor` → `npm run check-pins` → `npm test` → `npm run
self-check` → `npm run screenshots` → fresh run to `%TEMP%\shots` + `node
scripts/check-screenshots.mjs … --ignore-group=viewer3d` → `npm run manual:pdf`. Port
8765 free (close the installed FPV Sim). Afterwards refresh the installed copy (`npm run
dist` + the robocopy line in CLAUDE.md).

**Step 2 — main-process plumbing:**
- `src/main/window-layout.ts` (+35): `export function uiPageUrl(page, opts: {seed?, mode?,
  play?, dataset?})` — move the seed/mode/play rules from `windows.ts:253-260` verbatim;
  `dataset` honoured only for `dashboard.html` and only when `isDatasetFileName()` (import
  from `./results-manifest.js`, electron-free) — junk dropped, never an error; build the
  query by hand with `encodeURIComponent` (spaces → `%20`). Move `UI_PAGES` here.
- `src/main/windows.ts`: `openUiWindow(page, {…, dataset?})` uses `uiPageUrl`; in the
  singleton branch (L247-252), when the URL carries `dataset`, `existing.loadURL(url)`
  (a deliberate OPEN retargets the one Dashboard; a bare open only focuses, so OPEN
  DASHBOARD / tile / File ▸ Dashboard keep today's behaviour).
  `reloadDashboardWindows(dataset?: string)` (L288-299): with a file, `loadURL(uiPageUrl(
  "dashboard.html", {dataset}))` on each open dashboard; without, `reload()` as today.
- `src/main/studies/study-runner.ts:224`: on a successful registered run call
  `reloadDashboardWindows(<new file>)` so an open Dashboard jumps to the new run
  explicitly (today's documented behaviour, now deterministic instead of "newest first").
  Manifest mutations in `index.ts:213-214` keep the bare `reload()` (a deleted file's
  `?dataset=` falls back to newest silently on the page).
- `src/main/index.ts:105-114`: pass `dataset` (string only). Preload already spreads opts.

**Step 3 — headline helper** `src/main/results-headline.ts` (new, ~90 lines, electron-free):
`winRatesOf(entry)`, `studyBaselineFor(entry, datasets)` (first entry in manifest order —
newest-first — with kind=study, same mode, `baseline.win_rates`; legacy defaults
kind→study, mode→orbit, label→"Full study"), `datasetHeadline(entry, datasets)` →
`{rates, runs, baseline|null, deltaPts|null, text: "B 14.6% / O 14.4% / S 71.0%",
deltaText: "Δ vs Full study −33.4 / −13.7 / +47.1 pts" | null}`, `withHeadlines(listing)`
decorates each entry with `headline`. `index.ts:220`: `results-list` returns
`withHeadlines(listResults(...))`. `results-manifest.ts` untouched.

**Step 4 — Studies panel** `src/renderer/studies/index.html` (+60):
- LAST DATASET box (L91-100): new row `#dataset-headline` + button `#dataset-open` "OPEN
  IN DASHBOARD" (hidden for unregistered quick runs). `updateLastHeadline()` reads
  `dsData.datasets.find(file===dataset.datasetFile)?.headline`; call it at the end of
  `showDataset` (L213-231) and of `renderDatasets` (L461-485) because `onDone` paints
  before `refreshDatasets` resolves.
- `#dataset-open` click → `window.fpvApp.openWindow("dashboard", {dataset})`.
- `dsEntryRow` (L366-385): prepend `dsButton("OPEN", …)` when `!entry.missing` (allowed
  during a run; not a mutation). Meta line gains a `.note.ds-headline` span with
  `headline.text` (+ Δ). CSS: `.ds-headline{display:block;color:var(--bright)}`; raise
  `#ds-list` max-height to ~260px so four rows fit the `studies-datasets` clip.
- L279 OPEN DASHBOARD unchanged (newest / focus).

**Step 5 — self-check** `src/main/self-check.ts`: new 11th step after L91 — open
`app://ui/dashboard.html?dataset=monte-carlo-tactical.json` (bundled, not the newest),
assert `#dataset` selected text includes "Tactical study", `location.search` carries the
file, `#finding` non-empty; then `?dataset=nope.json` still reveals `#content`. Update
step counts in CLAUDE.md (10 → 11).

**Step 6 — tests:** `test/window-layout.test.ts` (+25): `uiPageUrl` validates/encodes
(`"My Export (1).json"` → `%20`, round-trips via `URLSearchParams`; `../x.json`,
`index.json`, `""`, non-string dropped; ignored for `index.html`; seed/mode/play rules
preserved); `uiKindForUrl`/`titleForUiUrl` with a query. New `test/results-headline.test.ts`
(~80): rates text; baseline by kind/mode with legacy defaults; other-mode study ignored;
null when absent; studies get no Δ; Δ sign + 1 decimal; `withHeadlines` preserves fields
incl. `missing`. Update the test count in README/CLAUDE.md.

**Step 7 — screenshot harness** `src/main/screenshots.ts`:
- `DASH_CARD` (L304) queries `main .card` instead of `#charts .card`; new `DASH_EVIDENCE(open)`,
  `DASH_FINDING_HAS(needle)`, `openEvidence(c)` (set open, wait `#evidence svg`, settle),
  `closeEvidence(c)`.
- `dashReady` (L328-334): keep status/content/prov waits; replace the `#charts .card svg`
  wait with `#finding` non-empty + ≥3 `#tiles .tile` + `DASH_FINDING_HAS(WALKTHROUGH_LABEL)`.
- Dashboard group (L478-557), 17 figures; full-window shots keep `#evidence` closed (what
  a user sees): `dashboard-overview` (+closeEvidence, scrollTo 0) · **`dashboard-finding`**
  (new, clip `#finding`, ad-hoc) · `dashboard-tiles-adhoc` · **`dashboard-vs-baseline`**
  (new, `DASH_CARD(/vs stock/i)`) · `dashboard-seeds` (openEvidence first) ·
  `dashboard-provenance` · `dashboard-tiles-full` · **`dashboard-finding-full`** (new) ·
  `dashboard-full-overview` (closeEvidence) · `dashboard-dose` (openEvidence) ·
  `dashboard-tooltip` · `dashboard-paired` · `dashboard-histograms` · `dashboard-adhoc-only`
  (closeEvidence) · `dashboard-tactical` (closeEvidence) · `dashboard-tactical-paired` ·
  `dashboard-header`.
- Studies group: `studies-finished` waits for `#dataset-headline` to contain "Δ";
  `studies-datasets` waits for ≥3 `.ds-headline`; captions updated. Expect 53 captured
  (50 + 3).

**Step 8 — manual:** `07-dashboard.md` rewritten (~190 lines, figures 7-1…7-17 in the
order above): intro (three layers) · 7.1 Opening (adds OPEN IN DASHBOARD / OPEN; NOTE:
an open Dashboard jumps to a finished run, keeps its dataset across Ctrl+R) · 7.2 Guided
exercise part B, reading the finding first · 7.3 Header · 7.4 The finding (how sentences
are generated; clear / slight / no measurable difference; reference = same-mode study;
degrade when absent → RESTORE; deterministic) · 7.5 COPY FINDINGS · 7.6 Tiles (+Δ row) ·
7.7 Key evidence (VS STOCK BASELINE; Paired comparisons) · 7.8 All evidence (dose,
timelines, notable engagements, provenance) · 7.9 Tactical · 7.10 Going further.
`06-studies.md` §6.2 table rows (LAST DATASET, DATASETS), §6.3 steps, §6.7; `03-launcher.md`
Ctrl+R note; `A-glossary.md` (Finding, Δ points, Key/All evidence, Newcombe CI; refine
Baseline); `F-troubleshooting.md` Dashboard rows; `G-faq.md` two entries; `README.md`
clause; `docs/manual/README.md` blurb; pin string `7050617` → new sha in
`docs/manual/README.md:3`, `02-install.md:56`, `03-launcher.md:64`, `G-faq.md:46`;
`CLAUDE.md` pin + Open-work bullet (proposal done).

**Step 9 — CHANGELOG** `[Unreleased]`: Added "The Dashboard leads with the finding" and
"Deep links to a dataset" (text drafted by the app-side agent, see transcript summary
above; reproduce in Keep-a-Changelog voice); Changed: pin `7050617` → new sha (dashboard
only; engine pin unchanged, parity pair holds); three new figures, dashboard + studies
figures regenerated. Release as **0.4.0** (bump `package.json` only at release).

Estimated: `window-layout.ts` +35, `windows.ts` ±10, `index.ts` +4, `study-runner.ts` +2,
`results-headline.ts` +90, `studies/index.html` +60, `self-check.ts` +30,
`screenshots.ts` +50/−10, tests +105, manual ~230, CHANGELOG +40.

## Verification

**PR 1 (fpv-sim), on the branch:**
1. `node scripts/check-dashboard-stats.mjs` — all check values pass; the stats block runs
   without a DOM; every manifest entry yields sentences + Markdown.
2. Serve the repo root (`python -m http.server 8000`; fetch is blocked on file://) and open
   `http://localhost:8000/dashboard.html`. Per dataset:
   - newest (ad-hoc 8°): verdict names the label; tiles 14.6 / 14.4 / 71.0 / 50.3 with Δ
     lines −33.4 clear, −13.7 clear, +47.1 clear, decisive −12.8 clear (reconstructed baseline counts); VS STOCK BASELINE
     dumbbells hollow 48.0/28.1/23.9 → filled 14.6/14.4/71.0; tooltip shows both CIs and
     n=1,000 / n=10,000; table view six columns; fold closed; open it → histograms, WATCH
     links `index.html?seed=681&play=1`, provenance text identical to today; COPY FINDINGS
     → COPIED and the pasted Markdown carries file + regen command.
   - Full study: no Δ lines; paired card pixel-identical (4 groups, tooltips, table);
     fold holds dose + histograms; verdict cites 48.0 vs 28.1 and the paired effects.
   - Tactical study: 5 tiles (4.5 / 4.5), 5 paired groups incl. reserve hunter, "packages
     spent", WATCH links carry `&mode=tactical`.
   - `?dataset=monte-carlo-tactical.json` lands on tactical; `?dataset=nope.json` → newest,
     URL untouched, no error; changing DATASET rewrites the URL and survives reload; SHOW
     → STUDIES ONLY updates the URL; a restored filter that hides the wanted entry flips to
     ALL. Console clean.
3. Dry-run the app harness against the branch: copy the branch's `dashboard.html` over
   `fpv-sim-app/build/resources/ui/dashboard.html` (untracked, regenerated by vendor),
   apply the Step 7 harness edits, `npm run screenshots -- --only=dashboard`, inspect the
   PNGs. Restore with `npm run vendor`.
4. Merge, tag the fpv-sim version (CHANGELOG-only cut), note the sha.

**PR 2 (fpv-sim-app), the CI ladder in order:** `npm run check-pins` → `npm test` (parity
smoke + adhoc equivalence untouched; new window-layout and results-headline suites) →
`npm run interop-check` → `npm run self-check` (11 PASS lines incl. the deep-link step) →
`npm run screenshots` (53 captured) → second fresh run to `%TEMP%\shots` +
`node scripts/check-screenshots.mjs … --ignore-group=viewer3d` → `npm run manual:pdf`.

**CDP smoke (real app):** `npx electron . --remote-debugging-port=9222`; Studies (Ctrl+3):
label `cdp smoke`, count 200, RUN PARALLEL; wait `#status` idle and `#dataset-headline`
reads `B … / O … / S … · Δ vs Full study …`; click OPEN IN DASHBOARD → the dashboard
target's URL is `app://ui/dashboard.html?dataset=adhoc-cdp-smoke-<date>.json`, `#finding`
contains "cdp smoke", `#dataset` shows the AD-HOC entry; change DATASET → `location.search`
follows; Ctrl+R keeps it; OPEN on the Full study row retargets the same window (no second
dashboard); run a second sweep → the open Dashboard jumps to it; DELETE the smoke dataset
→ the Dashboard reloads and falls back to newest without error.

**Installed copy:** `npm run dist` then the robocopy line from CLAUDE.md; confirm the
launcher's DASHBOARD tile still opens the newest.

## Out of scope (recorded)

Arbitrary A-vs-B dataset compare; per-run outcome persistence (would enable paired flips
for sweeps; a runner change); hand-written findings text; light theme; tabs.
