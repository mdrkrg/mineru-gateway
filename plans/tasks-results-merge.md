# Merge task results into the Tasks page

## Decision

`/tasks` is the single task surface. It has two URL-backed views:

- `/tasks` - all tasks, with the existing status/file filters and batch cancel.
- `/tasks?view=results` - tasks with downloadable results, with batch ZIP.

The sidebar exposes only **Tasks**.

## Council

Roster: `oracle` (forked context) and `reviewer` (runtime-default context),
because no `council-*` profiles are installed. Pass cap: 2. Both advisors
independently chose this option in Pass 1; no material dispute remained, so
Pass 2 was not needed. Run ids: `c7597fc7-0442-47df-8950-cc846369dcf8`
(oracle), `5d5b0368-2bd5-4f49-ae3f-de6888617d9d` (reviewer).

## Why

The two pages queried the same list with one flag (`has_result`) and differed
only in selection domain and batch action. Keeping both made users guess where
results lived, duplicated table markup, and hid result downloads from the task
list. A single page preserves every capability while making the result action
visible on the rows that have one.

Rejected alternatives:

- **One table with both batch actions.** A mixed selection makes Cancel and
  Download-ZIP ambiguous.
- **Two nav items with clearer names.** Still duplicates the same list.
- **Results as the default tab.** Hides in-flight monitoring, which is the
  operational default.

## Interaction model

- Tabs are real links, so the URL is shareable and the back button switches
  views.
- The results view hides the status filter: `has_result=true` already implies
  completed/partial.
- **All tasks:** only active rows are selectable; the batch action is Cancel.
  Rows with `hasResult` also get a per-row Download action.
- **Results:** every row is selectable; the batch action is Download ZIP.
- Selection is cleared on view change, filter apply, page change, and after a
  batch action.
- The dashboard "Results Available" card links to the results view.

## Responsive behavior

- Desktop/tablet (>= 40rem): the existing table, with the results view using
  Completed At instead of Tier/Created/Retries.
- Phone (< 40rem): one list surface with one row per task (no per-row card
  chrome). Filename is a single truncated line; a compact meta line carries a
  status dot + short label, compact timestamp, and short id. The relevant
  action sits at the trailing edge.
- On phones, selecting a row replaces the top batch button with a fixed bottom
  action bar (`Cancel selected` or `Download ZIP`) above the navigation FAB.

## Verification

- `pnpm test`, `pnpm typecheck`, `pnpm build`.
- Browser checks: dashboard deep link, batch ZIP, row download, back-button
  view state, and the mobile batch bar appearing, clearing, downloading, and
  hiding after success.
- Desktop and phone screenshots in `tmp/tasks-results-screenshots/`.
