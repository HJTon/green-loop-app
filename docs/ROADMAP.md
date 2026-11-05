# Green Loop App — Roadmap

Top-priority work is listed first. Each entry names the underlying bug, the fix,
and what shipping it prevents from happening again.

## Top priority

### 1. Offline retry queue for `maturing-bins-write`

**Bug.** `maturing-bins-write` is the one Green Loop write path with no offline
retry queue. Every other write to Google Sheets (bin counts, pickup notes,
report emails) persists into `localStorage` and retries on boot / on demand.
The maturing bins call in `ConsolidationPage.tsx` and `DropOffPage.tsx` just
toasts on failure and moves on, so any bin the driver serialises while the van
is out of coverage never lands on the Bin Tracker tab of the maturing-bins
sheet.

**Fix.** Mirror the existing pattern: add `greenloop_pending_maturing_bins` in
`storage.ts` (payload = the same body `maturing-bins-write` already takes, plus
`createdAt`), queue on any non-2xx / network error, and add
`syncPendingMaturingBins()` alongside the other syncs in `AppContext.tsx` so
boot / manual retry drains the queue.

**Prevents.** The "mystery bins" scenario — bins that physically arrived at the
farm but the compost monitor never saw. No more silent drops when a driver
consolidates offline.

### 2. "Unconsolidated bins" nudge on the route list

**Bug.** Nothing reminds a driver that completed pickups from an earlier day
never made it through Consolidation. If the driver forgot to run the
consolidation step (or bailed out before drop-off), the bins sit in the van
untracked and there is no on-screen prompt on the next day's route list.

**Fix.** On the route list, scan `greenloop_pickups` for completed pickups
dated before today with no matching `greenloop_consolidation` session (i.e.
same date, `completedAt` set). If any exist, show an amber banner that
tap-throughs to `/consolidation`. If the pending maturing-bins queue is also
non-empty, the banner mentions that too.

**Prevents.** The other half of the "mystery bins" story — bins that were
picked up but never consolidated, meaning the compost monitor still can't see
them even if the write path itself is healthy.

### 3. On-phone recovery / export screen

**Bug.** Chrome on Android has no built-in DevTools UI and blocks
`javascript:` URLs from the address bar, so on-phone extraction of the app's
localStorage previously required plugging into a computer. That blocked
recovery of six mystery bins from weeks ago and would keep happening every
time a driver needed to pull data without a laptop.

**Fix.** Ship a `/debug/export` route (not linked from the nav; findable by
typing the URL or via the amber nudge banner from item 2). Renders each
relevant localStorage key as a collapsible section with entry count, a "Copy
JSON" button, and a scrollable textarea preview. `greenloop_pickups` gets a
date-range filter so the driver can pull just the trip they need. A "Download
all as JSON file" button at the top saves a full snapshot.

**Prevents.** On-phone driver stuck without a way to hand raw data to Joe.
Also a permanent diagnostic surface for future support incidents.
