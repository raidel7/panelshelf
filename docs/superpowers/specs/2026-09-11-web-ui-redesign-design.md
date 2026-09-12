# Web UI redesign: legibility, navigation, affordance

Date: 2026-09-11
Status: approved, not yet built
Scope: `server/public/` only — the browser client. Not the iPad app, not the DSM package UI.

## The problem

Three distinct complaints, all verified against the code rather than assumed.

### 1. Legibility

`styles.css` has no type scale. Of 216 `font-size` declarations, 190 are 13px or
smaller and 63 are 9px or smaller:

| Size | Rules |
| --- | --- |
| 7px | 3 |
| 8px | 21 |
| 9px | 39 |
| 10px | 44 |
| 11px | 38 |
| 12px | 25 |
| 13px | 15 |

7–9px is not reserved for micro-labels. It carries real content:
`.comic-status-option strong`, `.check-option strong`, `.scan-action small`,
`.order-item-copy small`, `.timeline-cover-copy small`, `.control-label`,
`.role-badge`, `.confidence-badge`, `.drag-handle`.

Leading compounds it. There are 52 `line-height` rules against 216 `font-size`
rules, and `body` sets none — so roughly three quarters of the app is small text
at the browser default `normal` leading of about 1.2.

Hit targets are not the problem. `.button` is `min-height: 43px` and
`.icon-button` is 43×43.

### 2. Feature sprawl

17 `<dialog>` elements and 116 static buttons in `index.html`. `settingsDialog`
is a single flat scroll holding ten unrelated concerns: Library folders, Online
metadata, Backup and restore, Support bundle, Scheduled scan, Source health,
Library review, Cover cache, Reader profiles, Device pairing. Some dialogs open
only from inside that scroll — `libraryReviewDialog` is reached by a button
buried in it.

There is no routing of any kind: no `pushState`, no hash handling, no `popstate`
listener. Nothing in the app is linkable and the browser Back button does
nothing.

### 3. Affordance

23 buttons whose only content is an SVG. 19 carry an `aria-label`. There is not
one `title=` attribute in `index.html` or `app.js`, and no tooltip CSS anywhere.
A screen reader can name these controls; a sighted user cannot.

## Constraints discovered in the code

These shape the design more than any preference does.

- **`app.js` binds by id.** 0 `getElementById` calls, 340 `querySelector` calls,
  287 of them `#id` lookups, against 305 distinct ids in `index.html`. Markup can
  therefore be re-parented into a new shell and the wiring survives — provided
  the ids travel with the nodes.
- **Each dialog has exactly one `showModal()` call site.** Dialogs are cleanly
  encapsulated at their entry point, so converting one into a navigable section
  touches one line.
- **No build step.** `app.js` is a classic script under `"use strict"`, not a
  module; `index.html` has no `type="module"`. Additional scripts share global
  scope, so new files are added as extra `<script>` tags without restructuring
  `app.js`.
- **`server/test/ui.test.js` lines 11–285 are a structural contract test.** They
  assert specific ids and CSS class names exist in the markup. This test is
  updated deliberately as part of the work.

## Target context

Desktop and laptop browsers at desk distance. Body text 15px, with 13px the floor
for anything that is read as prose.

## Design

### Navigation

Five top-level destinations, replacing one page plus a gear icon over 17 modals.

| Destination | Absorbs | Rationale |
| --- | --- | --- |
| Library | today's shelf | Unchanged home: browse, filter, continue reading |
| Reading orders | `ordersDialog`, `orderDetailDialog`, `orderEditorDialog` | Frequently hunted for; earns top level |
| Sources | folders section of `settingsDialog`, `structureDialog`, `issuesDialog` | Frequently hunted for. Scan state, failures and folder health are one concern |
| Metadata | `metadataSettingsDialog`, `bulkMetadataDialog`, `libraryReviewDialog` | Providers, bulk enrichment and the review queue are one concern |
| Settings | backup/restore, support bundle, scheduled scan, cover cache, reader profiles, device pairing | The genuine leftovers — six items, not ten |

Eight dialogs stay modal, because each interrupts a flow rather than being a
place you navigate to: `readerDialog`, `folderDialog`, `permissionDialog`,
`comicPickerDialog`, `metadataDialog`, `metadataEditorDialog`, `bulkEditDialog`,
`bulkAssignDialog`.

Nine stop being modal and become content inside the four new sections.

### Routing

Hash routing — `#/library`, `#/orders`, `#/orders/:id`, `#/sources`,
`#/metadata`, `#/settings`. Hash rather than `pushState` because `public/` is
served statically with no SPA fallback, so a `pushState` URL would 404 on
refresh. This also gives the app linkable sections and a working Back button,
neither of which exists today.

### Type scale

Nine tokens replacing 216 ad-hoc declarations.

| Token | Size | Replaces | Rules | Change | Role |
| --- | --- | --- | --- | --- | --- |
| `--text-2xs` | 12px | 7–8px | 24 | +50% | badges and counters; never prose |
| `--text-xs` | 13px | 9px | 39 | +44% | micro-labels; the floor for read text |
| `--text-sm` | 14px | 10px | 44 | +40% | secondary text, `<small>` |
| `--text-base` | 15px | 11–12px | 63 | +30% | body, buttons, rows, inputs |
| `--text-md` | 17px | 13px | 15 | +31% | emphasised rows, card titles |
| `--text-lg` | 19px | 14–15px | 8 | +30% | sub-headings |
| `--text-xl` | 22px | 16–18px | 10 | +29% | dialog and section headings |
| `--text-2xl` | 27px | 20–24px | 3 | +20% | `h2` |
| `--text-3xl` | 34px | 27–28px | 3 | +18% | section leads |

The `h1` clamps are unchanged.

The gradient matters: +50% at the bottom of the scale, +18% at the top. The page
does not uniformly enlarge — the hierarchy compresses. The ratio from smallest
prose to `h1` falls from 6.5:1 to 4.3:1.

Three leading tokens accompany it — 1.25 for headings, 1.4 for rows, 1.55 for
prose — plus a `line-height` on `body` so the 164 rules that set no leading
inherit something deliberate. Spacing rises about 15–20%, deliberately less than
the type, or the page becomes enormous.

No user-facing text-size preference. Adding a setting to fix a design problem
makes the sprawl complaint worse.

### Affordance

The rule is: if a control has room for a word, it gets the word. A tooltip is a
patch for a missing label, not a substitute for one — tooltips everywhere would
still mean hovering 23 things to learn the UI.

`tooltip.js`, roughly 80 lines: one reused DOM node driven by a `data-tip`
attribute, about 120ms hover delay, immediate on `:focus-visible`, flipped near
viewport edges, honouring `prefers-reduced-motion`. The bubble is `aria-hidden`
and the existing `aria-label` remains the accessible name, so a screen reader
does not announce the same text twice.

Each new section carries a one-line subtitle stating what it is for. Destructive
actions — Full rebuild, Clear cache, Restore backup — stop being styled like
every other button.

## Files

| File | Change |
| --- | --- |
| `index.html` | Restructured shell: header, nav, five panels, eight remaining dialogs. All 305 ids preserved verbatim; nodes are re-parented, never renamed |
| `styles.css` | Token block, 216 `font-size` conversions, nav/section/tooltip rules |
| `router.js` | New, ~150 lines: hash routing, panel visibility, nav state, back/forward |
| `tooltip.js` | New, ~80 lines |
| `app.js` | ~20 lines: the nine `showModal()`/`close()` pairs that become navigation |
| `server/test/ui.test.js` | Lines 11–285 rewritten for the new shell |

Preserving ids verbatim is what holds the `app.js` change to about 20 lines
rather than thousands. It is not an optimisation; it is the load-bearing
constraint of this design.

## Verification

`npm test` runs `node --test server/test/*.test.js`, currently 507 tests.

Three regression guards are added, each encoding one of the three complaints:

1. No `font-size` below 12px exists anywhere in `styles.css`.
2. Every element carrying `data-tip` also has an accessible name.
3. Every `#id` that `app.js` queries exists in `index.html` — this catches an id
   dropped during re-parenting, which is the one failure mode that breaks the
   redesign badly and silently.

The behaviour tests from line 286 onward must pass untouched. A failure there is
a real regression, not a test to update.

## Explicitly out of scope

- The iPad app and the DSM package UI. This is the web client only.
- Splitting `app.js` into ES modules. It stays a classic script; the two new
  files are additional `<script>` tags.
- Light theme. The app remains `color-scheme: dark`.
- Any change to server endpoints or the scanning, metadata or reader logic.

## As built (2026-09-12)

Built in `3fc878b` and `c240c4f`. Three deliberate departures from the design
above, all discovered in the code rather than decided in advance:

- **Panels wear a dialog's interface rather than replacing its call sites.**
  app.js opens, closes and tests these ten views in 46 places. `panelShelf.panel()`
  returns the panel with `open`, `showModal()` and `close()` defined on it, so
  those 46 sites stayed correct and the routing semantics live in `router.js`
  once. The `elements` keys keep their historical `…Dialog` names; only what
  they point at changed. Nine registry lines, not 46 call sites.
- **Ids were renamed after all.** The design said preserve all 305 verbatim. The
  nine dialog ids turned out to be referenced *only* in those registry lines, so
  keeping `id="ordersDialog"` on a `<section>` would have been misleading for no
  benefit. They are `…Panel` now; the other 296 are untouched, and the third
  regression guard sweeps every id app.js queries.
- **Settings splitting cost more than the estimated ~20 app.js lines.** All four
  `settingsDialog.open` guards turned out to belong to the housekeeping half
  (cover cache, reader profiles, device pairing), not the folders half. Those,
  the backup-restore close, and the cover-cache `close` listener re-point to the
  new Settings panel, and `openSettings()` lost its tail: each destination loads
  its own data on arrival via a `panelshelf:route` listener, rather than opening
  the folder list also polling the cover cache.

Two header controls were also removed as redundant with the nav — the Reading
orders button and the gear — along with the Online metadata callout inside the
Metadata panel. 540 tests pass.
