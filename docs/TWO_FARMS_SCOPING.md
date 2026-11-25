# Adding a second farm (Kahu Glen) — scoping

Status: options doc, no code changes. Scope: how a second drop-off farm slots into the Green Loop Collector app alongside Eudaimonia.

## What's already wired in

A lot of the plumbing exists. The data model is multi-farm; only the inputs and the sheet aren't.

- **`src/data/farms.json`** is already a list, and already has a second entry (`"Chauncy's Place"`, id `"2"`, address `"TBD"`, active). Rename it, give it an address, and that half's done.
- **`src/data/coordinates.json`** only has `farm:1`. `getActiveFarmsWithCoords()` (in `routeOptimiser.ts`) filters out any farm without a coord entry, which is why only Eudaimonia currently appears in the finish picker. Add `farm:2` with Kahu Glen's lat/lng and farm 2 shows up everywhere a farm shows up.
- **Route optimiser.** Held-Karp already runs `start → stops → <any end>`, with the end as whichever farm the caller passes. `OptimiseRouteModal` already renders a farm dropdown over `getActiveFarmsWithCoords()`. If two farms are active with coords, both appear in the modal today — no optimiser changes needed to pick one farm per route.
- **Route type** already carries `destination_farm_id: string` (`src/types/index.ts`; `data/route.json` defaults to `"1"`; `sheetDataService` seeds `"1"`). The downstream pages (`RouteListPage`, `ConfirmationPage`, `DropOffPage`, `SummaryPage`, `ConsolidationPage`) all resolve the farm via `getFarmById(route.destination_farm_id)` — they'd Just Work with id `"2"`.
- **Split planner** (`SplitPlannerPage` + `useRouteSplit`) is already two-farm-aware: it builds its matrix as `[starts…, stops…, farms…]` and lets run 1 and run 2 pick different `finishId`s independently. So "split route to two farms in one day" is already supported in the code; it's just never been used because there's only been one farm with coords.
- **Consolidation / drop-off** read `route.destination_farm_id` and pass that farmId through to `createMaturingBin()`. The `MaturingBin` type already has a `farmId` field and `maturing-bins-write` receives both `farmId` and `farmName` in its POST body.
- **Downstream (Bin Tracker)** — this is the hole. See the compost monitor section.

So the real design question isn't "can the app handle a second farm", it's **how the farm gets chosen per route**, plus the Bin Tracker column.

## Compost monitor — the sheet needs a farm column

Bin Tracker today is implicitly single-farm. `maturing-bins-write.ts` already *receives* `farmId` and `farmName` in the request body but never writes them. The appended row is cols A–N:

| A | B–F | G | H | I | J | K | L | M | N |
|---|---|---|---|---|---|---|---|---|---|
| Date of collection | Content from (sources 1–5) | Bin serial | Colour | Date of maturation | Date of batching | Batch | Notes | Content from 6+ (overflow) | Source breakdown (JSON) |

With two farms writing into the same workbook, bins from Eudaimonia and Kahu Glen commingle on the same tab with no way to tell them apart. "SOURCE OF COMPOST TRUTH" stops being a single truth.

**Minimum sheet change:** add a Farm column. Options, in order of least disruptive:

1. **New col O "Farm"** — the breakdown JSON stays in N, Caroline's hand-filled columns don't shift. Easiest, lowest risk to formulas and the monitor's existing column reads. Backfill existing rows with `Eudaimonia`.
2. **One tab per farm** — "Bin Tracker — Eudaimonia", "Bin Tracker — Kahu Glen". Cleaner for Caroline but every reader (the monitor, the fix/backfill scripts, `maturing-bins-inspect`) learns which tab to hit. More work.
3. **Separate workbook per farm.** Overkill. Don't.

Recommend option 1. One column, no formula movement, writer change is one extra string in `rowData` and one more sheet column mapped. The monitor and all the `maturing-bins-*.ts` cousins need a one-line update to acknowledge col O exists (even if they ignore it).

## Options for farm selection

### 1. Per-trip picker (small)
Driver picks the farm when the day's route is built — the finish dropdown that's *already in `OptimiseRouteModal`*. Persist the choice onto `route.destination_farm_id` for the day. The whole trip ends at that farm; every bin consolidated at drop-off inherits that farmId.

- **UX:** Add a prominent "Finish at" selector on the route-start screen (or make the existing modal's dropdown mandatory before optimising). Default to last used.
- **Data model:** No change. Already supported end-to-end.
- **Trade-off:** Simple, obvious, driver-controlled. Doesn't exploit the fact that one farm might be closer to today's stops than the other — that's on the driver to notice. No capacity awareness.
- **Effort:** Small. UI copy + persisting the pick + Kahu Glen coords + Bin Tracker farm column.

### 2. Geographic rule / "optimiser picks the farm" (small–medium)
Run Held-Karp twice internally — once with each active farm as the end — and show the driver the lower-km total, with the farm name as a confirmation. No boundary line to maintain; distance decides.

- **UX:** No picker. "Optimised route finishes at Kahu Glen (saves 7.2 km vs Eudaimonia)." Driver can override via a secondary tap.
- **Data model:** No change.
- **Trade-off:** Zero driver cognitive load, actually uses the second farm. But removes human judgement (one farm may have a locked gate at 4pm; the optimiser doesn't know). Mitigated by the override.
- **Effort:** Small–medium. Two matrix lookups, pick the min, show the diff. Everything else is option 1.

### 3. Capacity-based routing (large)
Each farm has a daily or weekly maturing-bin capacity. New bins route to whichever has room. Over capacity → the other farm, or alert.

- **UX:** Mostly invisible; "Finishing at Kahu Glen (Eudaimonia full this week)" banner on the route screen.
- **Data model:** Capacity per farm in `farms.json`, running count from Bin Tracker, live read on route build. Needs the sheet read to be fast and reliable.
- **Trade-off:** Smart. Avoids overwhelming one farm. But now the app depends on real-time Bin Tracker reads at route-build time, with a failure mode (sheet read fails → ???). And capacity numbers are guesses until you've run both farms for a season.
- **Effort:** Large. Needs capacity data, a reader, a fallback, UX for the override, and tests.

### 4. Split route — two farms in one day (medium, mostly already built)
Some bins end at Eudaimonia, some at Kahu Glen. Driver splits the stop list across two runs with different finishes. **The Split Planner already does exactly this** — `useRouteSplit` builds a shared matrix over `[starts…, stops…, farms…]` and `planRun(stopIds, { startId, finishId })` already accepts a per-run finish. It's just never been exercised with two real farms.

- **UX:** Driver opts in via existing Split Planner, picks a different farm per run.
- **Data model:** The current `destination_farm_id: string` on Route doesn't model "two farms this day". Options: store per-run finishId on the Route stops (there's already a `stop.run` field used by the planner), and have Consolidation key maturing bins off the stop's run → farm. Or: split the day into two Route objects.
- **Trade-off:** Highest flexibility; actually uses the second farm as a logistics asset. But the consolidation flow needs to know "this bin's contents came from stops in run 2, so its farmId is run 2's finish". That's a real change in Consolidation state.
- **Effort:** Medium. Optimiser work is zero; consolidation + drop-off state is where the work is.

### 5. Default + override (small, additive on top of 1)
Each driver has a default farm (settings-level), used unless overridden at route-start or at drop-off.

- **UX:** Settings row "Default drop-off farm" per driver. Route starts with that pre-selected; override on route screen or on drop-off.
- **Data model:** Add `default_farm_id` to collector/settings. Everything else is option 1.
- **Trade-off:** Nice QoL once you have >1 driver with a usual farm. Fewer taps per day. Doesn't help optimality.
- **Effort:** Small. Only interesting once you've shipped option 1 or 2.

### 6. Bin-type / waste-stream routing (unknown — flag for Joe)
If different farms accept different streams (e.g. one takes only food scraps, the other handles coffee grounds + bokashi), each bin's content dictates its farm. **This is a guess** — Joe needs to confirm whether the farms actually have different acceptance rules or whether this is purely a logistics split. If no, drop this option. If yes, it becomes a hard constraint on top of options 1/2/4.

## Recommendation

**Ship option 1 (per-trip picker) first, with the Bin Tracker col-O farm column.** Reasons, no hedging:

1. The whole app is 90% ready for it — `destination_farm_id` already propagates to every downstream screen, the optimiser doesn't care which farm it ends at, `maturing-bins-write` already has `farmId` in the request body. Shipping day one is unblocking Kahu Glen as a destination, not re-architecting the app.
2. The sheet change (col O) is unavoidable *regardless* of which option you ship — do it first and every later option builds on it.
3. It gives you real operational data from two farms before you commit to a smarter rule. Capacity-based (option 3) is premature without that.
4. Option 2 (optimiser picks) is the natural follow-up and is a small add on top: the picker becomes a suggestion with a km-saving badge. Ship it once Kahu Glen has run live for a week or two.

Flag for Joe before building: confirm there's no waste-stream constraint (option 6 question). If both farms accept everything, lock in options 1 → 2 → (later) 5.

## Open questions for Joe

1. Kahu Glen's address + lat/lng (to drop into `farms.json` and `coordinates.json` as `farm:2`).
2. Do both farms accept the same waste streams, or is there a routing constraint?
3. Should the driver choose per route, or should the app suggest based on distance (option 1 vs option 2 as the first ship)?
4. How does Caroline want the farm column in Bin Tracker — new col O, or one tab per farm?
5. Does rename "Chauncy's Place" → "Kahu Glen" in `farms.json` id `"2"`, or is Chauncy's Place a third farm?
