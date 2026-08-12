# PanelShelf Product and Engineering Roadmap

Updated: 2026-07-31

PanelShelf is a native, read-only Synology DSM comics server for CBZ and CBR
libraries. Its goal is to make an existing comics collection immediately useful
without forcing the owner to rename, move, copy, or reorganize the original
files.

This roadmap assumes one primary developer. Time estimates are planning ranges,
not release promises; testing on real Synology hardware is the main variable.

## Product principles

1. **Respect the user's organization.** Folder names, filename numbering, and
   existing chronological arrangements are intentional data.
2. **Never modify comic sources.** PanelShelf requires read-only access and
   stores all generated data in its private package directory.
3. **Work with internal and USB storage.** A disconnected source remains
   configured and its last-known library data is preserved.
4. **Make failures understandable.** Every skipped source or archive must appear
   in Scan Issues with a useful recovery action.
5. **Keep installation native.** No Docker, Java, or separately installed
   runtime should be required.
6. **Do not expose an unsafe server.** LAN use comes first; authenticated remote
   use arrives before PanelShelf is marketed for internet access.

## Current baseline

### 0.1 preview — completed

- Native DSM 7.2+ SPK and restricted `PanelShelf` package account
- x86-64 build for the DS1825+ and similar models
- Multiple internal-volume and external-USB source folders
- Server-side folder browser limited to `/volume*` and `/volumeUSB*`
- Recursive CBZ and CBR discovery
- First-page covers, searchable cover grid, and browser reader
- Fit-width and fit-height reading
- Persistent settings and library index
- DSM Package Center and desktop Open shortcut
- Scan issue reporting in the latest preview

### 0.2 structure foundation — build 1007 completed

- Versioned source records and automatic migration from `libraryPaths`
- Loose, series-folder, hierarchical-timeline, exact-order, and unordered
  source profiles
- Automatic supported-layout detection with explicit user confirmation
- Read-only hierarchy preview with Publisher, Ordered section, Group, Series,
  Unfiled, and Ignored roles
- Publisher/imprint alias catalog and confidence display
- Integer and dotted branch-relative rank parsing
- Profile validation and overlapping-source prevention
- Configurable `_` staging-folder behavior and prefix display
- Last-known comic retention for disconnected USB sources

Build 1007 is an engineering checkpoint. Its remaining metadata and scan-action
work is retained below and does not block the reading foundation.

### 0.3 reading foundation — build 1008 completed

- Browser-local per-comic progress, Continue Reading, and reading-state filters
- Automatic reading contexts derived from each source convention
- Context-aware Next Comic navigation with safe folder/series boundaries
- Manual chronology CRUD, duplicate, drag-and-drop, multi-select, and search
- Unplaced handling for comics discovered after a manual order is created
- Reading-order detail views with cover, description, progress, and item count
- Single, double, manga/right-to-left, and continuous-scroll reader modes
- Archive fingerprints and stable identity after an unambiguous in-source move

### 0.3.1 library views — build 1009 completed

- Main-page view switcher for All comics, Publishers, and Chronological
- Reading-status filters remain independent of the selected library view
- Publisher collection cards with canonical publisher/imprint grouping
- Publisher recognition when the selected source root is itself named for a
  known publisher
- Hierarchical chronology browser with breadcrumbs, child collection cards,
  and comics stored directly at the current folder
- Numeric sibling ordering without flattening or inventing an order across
  unnumbered branches
- Staging content remains outside chronology and unsupported source profiles
  are called out explicitly

### 0.3.2 chronology tracking — build 1010 completed

- Circular chronology-position chips preserve each folder's original numeric
  prefix, including zero padding and dotted insertion values
- Folder and arc branches can be marked Skipped without changing source files
  or manual reading orders
- Skipped collections have a distinct muted, crossed-out presentation
- A Chronological-view filter hides or reveals skipped branches
- Skipping a parent visually and functionally applies to its descendants
- Skip state and filter preference are browser-local, matching the current
  progress-storage model

### 0.3.3 cover-first collection browsing — build 1011 completed

- Publisher and chronology collections now use prominent portrait cover tiles
  with their titles underneath
- Collection titles adapt across four text sizes and can use up to three lines
  before truncating
- Chronology position and Skip controls remain visible as compact overlays on
  the cover
- Fine-pointer desktop browsers show an enlarged, viewport-aware preview after
  hovering a collection
- The preview exposes a structured area for richer publisher, creator, date,
  and series information when metadata enrichment arrives
- Touch and coarse-pointer devices retain the direct two-column collection
  grid without hover-only behavior

### 0.3.4 Unfiled shelf and comic status controls — build 1012 completed

- `_` staging-folder comics appear on an explicit Unfiled shelf from the
  Chronological view instead of existing only as an explanatory issue count
- The Unfiled shelf stays outside chronology and never receives an invented
  order number
- A persistent Unfiled count chip provides access while browsing deeper
  chronology branches
- Every comic card has a `•••` menu for Unread, In progress, Completed, and
  Skipped
- Marking a comic Unread clears its saved browser-local progress
- Marking a comic Skipped removes it from Continue Reading and makes
  context-aware Next Comic navigation pass over it
- Comic status remains separate from folder/arc Skip state, and both are
  browser-local without modifying source files

### 0.3.5 embedded ComicInfo metadata — build 1013 completed

- Read `ComicInfo.xml` from CBZ and CBR archives without modifying them
- Store embedded title, series, issue, volume, date, publisher, imprint,
  creators, genre, tags, story arc, language, rating, and summary fields
- Prefer embedded title, series, and publisher data over filename inference
  while preserving explicit folder and reading-order authority
- Use embedded issue numbers for local series ordering when both compared
  comics provide them
- Show an XML badge and surface creator, year, issue, and publisher details in
  cards, collection previews, search, and the reader
- Treat malformed or oversized ComicInfo data as a warning without dropping the
  comic or blocking its pages

Build 1013 is an implementation checkpoint included in the combined build 1014
release package.

### 0.3.6 scan actions — build 1014 completed

- Quick Scan walks configured sources and reuses unchanged indexed archives
- Scan One Source refreshes one selected internal or USB source while
  preserving all other sources
- Retry Issues rechecks only failed files or unavailable sources from the
  durable latest scan report
- Full Rebuild reopens every archive and rereads page and ComicInfo metadata
- Scan progress reports checked, reopened, reused, retained, and indexed counts
- Errors and non-blocking metadata warnings share one persisted latest-scan
  report and one consistent Issues count

### 0.3.7 optional online metadata enrichment — build 1016 completed

- Added an internal provider boundary with Metron as the first, disabled-by-
  default issue lookup provider
- Added revocable bearer-token configuration with masked browser responses and
  permission-restricted private persistence
- Added explicit per-comic search, candidate selection, full-detail review,
  field-by-field comparison, confirmation, refresh, and removal
- Added 24-hour search and seven-day issue caches, reactive provider
  rate-limit state, `Retry-After` handling, and stale-cache fallback
- Added stable Metron record IDs, provider attribution, and a confirmed-match
  badge on comic covers
- Added a temporary allowlisted cover proxy without writing third-party images
  into the comic source or permanent cover index
- Kept local scans, reading, and existing matches functional without an
  internet connection
- Kept embedded ComicInfo values authoritative; confirmed provider metadata
  fills missing display/search fields and never changes chronology
- Build 1016 adds edition-aware matching for trade paperbacks, hardcovers,
  omnibuses, and graphic novels. It searches Metron's series type before its
  issue/volume records, detects common `v01`/TPB/HC filename conventions, and
  distinguishes a missing collected edition from a failed query.
- Commercial distribution with Metron remains gated on explicit provider
  approval

### 0.3.8 smart metadata strategy — build 1017 completed

- Added GCD as the default comics and collected-edition matcher
- Added scored matching across series, title/subtitle, issue or volume, year,
  publisher, and edition type
- Added a manual Smart fallback strategy that stops after a strong match
- Kept Metron as an optional token-based secondary source
- Added Open Library as a no-key collected-book fallback
- Added per-provider controls, attribution, masked credentials, independent
  caches, and source/confidence labels in the review flow
- Added settings migration without rescanning or changing existing confirmed
  matches
- Continued to keep provider metadata outside source archives and outside all
  chronology calculations

### 0.3.9 OPDS reader access — build 1018 completed

- Added a read-only OPDS 1.2 root catalog at `/opds`
- Added catalogs for All comics, Publishers, Sources and recursive folders,
  automatic chronologies, manual reading orders, and search
- Added local cover and thumbnail links plus direct CBZ/CBR acquisition
- Added HTTP byte-range support for reader apps that stream archives
- Preserved PanelShelf order inside automatic and manual reading-order feeds
- Removed the Comic Vine provider, its BYOK controls, saved credentials,
  provider cache, confirmed matches, tests, and legal notices
- Kept OPDS progress read-only; generic reader progress is not imported into
  PanelShelf

### Remaining foundation gaps

- No user accounts, OPDS authentication, metadata editor, or marketplace-ready
  support workflow yet.

## Library organization model

The interface should avoid using “scan mode” for two different concepts.
PanelShelf will separate:

- **Organization profile:** how a source is arranged on disk
- **Scan action:** how thoroughly PanelShelf refreshes the index

Each source folder receives its own organization profile. Different profiles
may coexist in one PanelShelf library.

### Organization profiles

| Profile | Intended layout | PanelShelf behavior |
| --- | --- | --- |
| **Loose comics** | Comic archives stored directly in the selected source folder | Treat every archive as a comic and natural-sort its filename. Child folders containing comics make the source fail this profile's validation. |
| **Folders as series** | The first folder beneath the source represents a series; an optional second folder represents a volume or arc | Group by the documented folder roles and sort issues within their containing folder. Do not infer a cross-series reading order. |
| **Hierarchical timeline** | A publisher library organized into ordered eras/collections, unnumbered category folders, and staging folders | Preserve the hierarchy and order numbered siblings at each branch. Do not claim that every comic across all branches has one global next item. |
| **Exact reading order** | Every ordered comic or branch has an explicit unique sequence position | Create a continuous reading sequence and treat its numeric prefixes as authoritative. |

**Detect a supported layout** is a setup convenience, not an additional
organization profile. It tests the source against these four contracts and
asks the user to confirm the result. If no contract matches, PanelShelf may
index the files as an **unordered library**, but must not invent or advertise a
chronology.

The setup screen must ask the user to choose or confirm one convention and show
a copyable filesystem example. “Use whatever folder order happens to exist” is
not a supported chronology convention.

### Supported layout contracts

#### 1. Loose comics

```text
/Comics/Bellatrix/
  Bellatrix T01.cbz
  Bellatrix T02.cbz
  Bellatrix T03.cbz
```

Rules:

- Comic archives are direct children of the selected source.
- Filenames may use natural issue tokens such as `3`, `003`, `#003`, `T03`, or
  `v02 #003`.
- Metadata enrichment can improve the titles, but filename order remains the
  fallback.
- This profile does not claim to represent a cross-series chronology.

#### 2. Folders as series

```text
/Comics/
  Bellatrix/
    Bellatrix T01.cbz
    Bellatrix T02.cbz
  Batman/
    Volume 01/
      Batman 001.cbz
```

Rules:

- The first folder is always the series/collection.
- One optional nested folder may represent a volume or arc.
- Comic files must be inside a series folder, not mixed with comics at the
  source root.
- Each issue must have a usable issue/tome number in its filename or embedded
  metadata.
- Sorting applies within a series or volume only; folder names do not create a
  global reading order.

### Chronology examples

#### 3. Hierarchical timeline

```text
/Comics/Marvel/
  _unsorted/
  00 Alternate Timelines/
  04 The Golden Age (1935-1948)/
  09 Modern Age (1985-2012)/
    _Loose issues/
    0001 Rocky Grimm, Space Ranger/
    0029.1 Daredevil - Love's Labors Lost/
    0030 Secret Wars II/
    0030.1 Unnamed/
  Anita Blake Universe/
```

Rules:

- The selected source name or its first recognized folder may identify the
  publisher.
- A leading numeric token orders that item among other numbered siblings.
- Supported tokens include integers and dotted decimal insertions such as
  `09`, `010`, `0.224`, `029.1`, and `36.001`.
- A space is sufficient after the number; ` - ` is recommended but not
  required.
- Numeric gaps are allowed.
- Duplicate prefixes are allowed as equal-rank buckets and then sort by label;
  the preview warns when the duplicate may be accidental.
- An unnumbered folder is a grouping branch, alternate universe, family,
  category, or reference collection. It does not receive an invented timeline
  position.
- A folder beginning with `_` is staging/unfiled content. By default it is
  indexed into an **Unsorted** shelf but excluded from the timeline. The user
  may exclude staging folders completely.
- Numbering may restart inside each branch because the key is relative to the
  parent.
- Loose comic files inside an era appear in a **Loose comics** group for that
  era. They are not interleaved into numbered child collections unless they
  have explicit positions under an exact reading-order profile.

DC-style grouped events are also valid:

```text
/Comics/DC/
  04 New 52 Chronology (2011-2016)/
    Batman Family/
    Green Lantern/
    Major Events/
      001 Night of the Owls/
      002 The Culling/
      003 RotWorld/
    Superman Family/
```

Here, `04 New 52 Chronology` is an ordered era, `Major Events` is an unnumbered
grouping branch, and its numbered children are ordered events. `Batman Family`
and `Superman Family` remain named collections; their alphabetical placement
must not be misrepresented as historical chronology.

The numeric-prefix parser uses the leading token only:

```text
^(\d+(?:\.\d+)*)\s*(?:-\s*)?(.+)$
```

PanelShelf retains the original text for display and uses a normalized numeric
value plus the remaining label as the deterministic sort key. It never renames
the user's folders.

#### 4. Exact reading order

Flat form:

```text
/Comics/DC Exact Order/
  0001 - Batman Year One.cbz
  0002 - The Man Who Laughs.cbz
  0003 - The Long Halloween.cbz
```

Nested form:

```text
/Comics/DC Exact Order/
  001 - Early Years/
    001 - Batman Year One.cbz
    002 - The Man Who Laughs.cbz
  002 - The Long Halloween/
    001 - The Long Halloween 01.cbz
    002 - The Long Halloween 02.cbz
```

- Every item that participates in the continuous sequence must have an explicit
  unique numeric position.
- Fixed-width integer prefixes followed by ` - ` are recommended.
- Dotted insertion positions are accepted so users can add items without
  renumbering the entire collection.
- Publisher/imprint containers may be unnumbered only when confirmed as
  non-ordering containers.
- Mixed numbered and unnumbered sequence items are invalid in this profile.
- Arbitrary phrases such as `read this first` or filesystem creation/modified
  dates are never interpreted as order.

Numeric prefixes may be hidden from display names, but must remain part of the
sort key. PanelShelf must never rename the source files.

For a chronology that interleaves issues from several series, use a flat exact
reading order or give every participating item a compatible explicit position.
The hierarchical timeline profile cannot provide global next/previous behavior
across unnumbered branches.

### Structure validation

Before the first scan, PanelShelf validates the selected profile and reports
specific problems:

- files at a forbidden depth
- mixed loose files and series folders
- malformed numeric prefixes
- missing or duplicate positions in an exact reading order
- mixed numbered and unnumbered items in an exact sequence
- unnumbered branches that cannot participate in a global reading order
- issue/tome number missing from both filename and embedded metadata
- ambiguous publisher/imprint containers

For a hierarchical timeline, duplicate ranks and unnumbered group branches are
warnings or classifications, not automatic failures. For an exact reading
order, they are blocking errors until the user fixes or reclassifies them.

The result screen offers:

1. use the detected supported profile
2. choose another supported profile
3. index as unordered
4. reorganize the folders and test again

Future versions may support a PanelShelf manifest for complex explicit orders.
The first release will not attempt to interpret arbitrary custom layouts.

### Publisher-aware hierarchy detection

Chronology mode must examine both the selected source folder's name and its
top-level folders before deciding what each folder represents. A top-level
folder named `DC`, `Marvel`, `Image Comics`, `Dargaud`, or another recognized
publisher is a **publisher layer**, not automatically a series, era, or
chronology chapter.

The virtual hierarchy becomes:

```text
Source → Publisher → Imprint/era/arc → Series or comic
```

Publisher detection uses several signals:

1. exact or normalized match against a maintained publisher and imprint alias
   catalog
2. agreement with `Publisher` or `Imprint` from sampled `ComicInfo.xml` files
3. publisher/year patterns in filenames, such as `(Dargaud 2024)`
4. an optional online metadata match when a provider is configured
5. the user's choice in the source interpretation preview

Publisher and imprint remain separate fields. For example, `Vertigo` may be
stored as the displayed imprint with `DC` as its parent publisher; PanelShelf
must not erase the original folder label.

Detection is confidence-based:

- **High:** exact known alias plus agreement from embedded metadata
- **Medium:** exact known alias without conflicting evidence
- **Low:** fuzzy name or filename-only inference
- **Ambiguous:** conflicting signals or a generic name such as `Image`

High-confidence results may be selected automatically in the preview. Medium,
low, and ambiguous results require visible confirmation. Users can classify
any hierarchy level as Publisher, Imprint, Ordered section, Group, Staging,
Series, Ignore, or Automatic.

Publisher detection does not create or split a reading order by itself. A
publisher or imprint folder is a non-ordering container only after it is
recognized or explicitly confirmed. If several unnumbered publisher folders
exist, each is validated as a separate library/chronology branch; PanelShelf
does not fabricate a combined order across them.

### Ordering strategies

Ordering is stored separately from the organization profile so every layout can
eventually support more than one reading order.

| Order | Use |
| --- | --- |
| **Natural filename** | `2.cbz` appears before `10.cbz`; suitable for loose files and sorting within series folders. |
| **Branch-relative rank** | Orders numbered eras, groups, or collections among their siblings in a hierarchical timeline. |
| **Explicit sequence position** | Required source of truth for an exact reading order. |
| **Natural full path** | Provides deterministic display order after folder roles and numeric ranks are resolved; it does not turn arbitrary nesting into chronology. |
| **Embedded issue number** | May sort issues within one series when filenames lack a usable number; it never creates a cross-series chronology. |
| **Manual order** | User-created drag-and-drop order, stored only in PanelShelf. It can span folders and sources. |

When a manual order exists, rescanning may add newly discovered items to an
“Unplaced” section. It must not silently reorder existing entries.

## Scan actions

The Scan button will open a small menu once these actions exist:

| Action | Behavior |
| --- | --- |
| **Quick scan** | Default. Walk configured sources and compare path, size, and modified time. Reopen only new or changed archives. |
| **Scan this source** | Quick-scan one selected source. Useful for removable USB libraries. |
| **Retry issues** | Recheck only inaccessible or failed sources/files from the latest scan. |
| **Full rebuild** | Reopen every archive, reread metadata and page lists, and regenerate missing or stale covers. |
| **Scheduled scan** | Later option: daily or weekly quick scan, disabled by default. |

Removing a source is different from a source being unavailable. Removing it
intentionally removes its indexed items after confirmation. An unavailable USB
source retains its last-known items and shows an unavailable badge.

## Source setup experience

Adding a source should be a short wizard:

1. **Choose folder** from an internal volume or USB device.
2. **Check access** to the source, its ancestors, and a small sample of entries.
3. **Choose organization**: Detect a supported layout, Loose comics, Folders as
   series, Hierarchical timeline, or Exact reading order.
4. **Validate and preview** the detected hierarchy, ordering keys, and 5–10
   representative files before saving.
5. **Name the source** or accept the folder-name default.
6. **Save and quick scan**.

The preview is an important safeguard. It should show:

- each folder's interpreted role: publisher, ordered section, group, staging,
  series, or ignored
- detected publisher and imprint with confidence
- detected series/collection
- displayed title
- reading-order position
- source-relative path
- any permission or archive problem

Settings remain editable without removing or rescanning unrelated sources.

## Required data-model migration

The legacy configuration:

```json
{
  "libraryPaths": ["/volumeUSB1/usbshare/Comics"]
}
```

will migrate automatically to:

```json
{
  "schemaVersion": 2,
  "sources": [
    {
      "id": "stable-source-id",
      "name": "Comics",
      "path": "/volumeUSB1/usbshare/Comics",
      "organizationProfile": "unordered",
      "defaultOrder": "natural-filename",
      "recursive": true,
      "needsProfileConfirmation": true
    }
  ]
}
```

Indexed comics will gain:

- `sourceId`
- `relativePath`
- `folderSegments`
- interpreted folder role: publisher, ordered section, group, staging, series,
  or ignored
- branch-relative numeric rank, original prefix text, and normalized label
- `naturalPathKey`
- validated `sequencePathKey` for chronology profiles
- structure-validation status and issues
- parsed `publisher`, `imprint`, `series`, `volume`, `issue`, `year`, and
  `title`
- metadata origin: embedded, filename, folder, or manual
- inference confidence and the signals used
- external-provider name and stable record ID when the user confirms a match
- availability state
- archive fingerprint

Collections will be independent records:

- **Series** — grouped comic issues
- **Folder collection** — mirrors a meaningful on-disk folder
- **Reading order** — ordered comic memberships, automatic or manual
- **Storyline** — a named reading order with optional description and cover

Stable source and comic identifiers must survive an ordinary rename when the
archive fingerprint makes the move unambiguous. Ambiguous matches remain new
items rather than risking incorrect history.

## Metadata integration strategy

PanelShelf should support online metadata, but local scanning must never depend
on an external service. Metadata enrichment is a separate, optional operation
after discovery.

### Metadata priority

From highest to lowest authority:

1. manual PanelShelf edits
2. embedded `ComicInfo.xml`
3. a user-confirmed online-provider match
4. publisher/folder/filename inference

An automatic rescan may fill empty fields but must not overwrite a higher
priority value.

### Provider architecture

Online services plug into one internal provider interface that can:

- search publishers, series, and issues
- retrieve issue metadata and creator credits
- retrieve story arcs or reading lists when supported
- return stable provider IDs and attribution links
- expose rate-limit and retry information

PanelShelf normalizes provider responses into its own data model. Provider-
specific fields remain namespaced so adding or removing one service does not
require redesigning the library.

Provider metadata and local ordering remain separate pipelines. Story arcs or
reading lists returned by a provider are optional import candidates, not
authority over a source's hierarchy or exact reading order. Applying one
requires a separate user action and creates a new PanelShelf reading order; it
never rewrites the source profile or sequence prefixes.

External lookup rules:

- opt-in only; explain that search terms derived from filenames may leave the
  NAS
- use a user-owned token/key rather than one shared key embedded in the SPK
- encrypt or permission-restrict stored credentials and mask them in the UI
- cache confirmed results and honor `ETag`, `Last-Modified`, `Retry-After`, and
  provider rate limits
- show candidate matches with confidence; do not silently accept uncertain
  matches
- keep provider outages and authentication failures out of the local scan
  failure count
- fetch textual metadata first; do not redistribute or permanently cache
  third-party cover artwork until its terms are confirmed

### Provider order

1. **ComicInfo.xml first.** It is local, fast, private, and already used across
   comic-management applications. Version 0.2 reads the minimum fields needed
   for structure inference; version 0.4 adds complete metadata support.
2. **Grand Comics Database first online.** Build 1017 uses its issue and series
   API for comics and collected editions, keeps local covers, and shows source
   and CC BY-SA attribution.
3. **Metron second when configured.** The token-authenticated integration
   remains available for permitted use. A paid or broadly distributed release
   must verify its commercial-use and attribution permissions.
4. **Open Library for collected books.** Build 1017 uses it only after comics
   providers fail to strongly match a trade, hardcover, omnibus, or graphic
   novel.

No single provider should be treated as complete. Publisher aliases and manual
correction remain important for international libraries, including European
and Franco-Belgian publishers.

## Release plan

### 0.2 — Library Structures

**Status:** build 1007 engineering checkpoint completed  
**Estimated effort:** 2–3 weeks

- Replace `libraryPaths` with versioned source records and automatic migration.
- Add all four organization profiles and supported-layout detection.
- Add structure validation with an unordered fallback for unsupported layouts.
- Add a maintained publisher/imprint alias catalog with user-defined aliases.
- Add publisher-aware hierarchy inference and confidence display.
- Read the minimum `ComicInfo.xml` fields needed to classify publisher, imprint,
  series, and issue.
- Implement natural filename sorting, branch-relative dotted ranks for
  hierarchical timelines, and validated positions for exact reading orders.
- Add source interpretation preview.
- Add Quick, Selected Source, Retry Issues, and Full Rebuild actions.
- Preserve last-known items for disconnected USB sources.
- Prevent duplicates when configured source folders overlap.
- Persist the latest completed scan and derive the toast, issue badge, and issue
  panel from that same record.
- Classify access failures as source, directory, or archive failures.
- Add Recheck Access and Retry Source actions.
- Keep all source access read-only.

**Release gate**

- All structure cases in the scanning test matrix pass.
- Existing 0.1 configuration migrates without losing sources.
- A chronology has the same order after rescan and service restart.
- Unplugging and reconnecting a USB source does not lose its library identity.
- An unchanged quick scan does not list pages or regenerate covers.

### 0.3 — Reading and Manual Chronologies

**Status:** build 1008 completed  
**Estimated effort:** 2–3 weeks

- Continue Reading row and per-comic page progress.
- Completed/unread/in-progress/skipped states with direct per-comic controls.
- Next comic follows the active reading context. Series and ordinary folder
  contexts stay within that boundary; exact and manual orders may cross
  folders; hierarchical timelines stop instead of guessing across unrelated
  unnumbered branches.
- Create, rename, duplicate, and delete manual reading orders.
- Drag-and-drop chronology editor with multi-select.
- “Unplaced” handling for new comics discovered after a rescan.
- Reading-order detail page with cover, description, progress, and item count.
- Single-page, double-page, manga/right-to-left, and continuous-scroll reader
  modes.
- Browser-local guest progress first, with a migration path to user accounts.

Build 1008 implements this scope. Automatic orders are derived records;
manual orders are persisted in `reading-orders.json` inside PanelShelf's
private package data directory. Reading progress now lives on the server in
`progress.json`, shared by every browser; it was browser-local through build
1008.

**Release gate**

- Closing and reopening the browser restores progress.
- A manual chronology remains stable after source rescans and file moves.
- Reader navigation never jumps to a different series/order unexpectedly.

### 0.4.0 — Backup and Restore — build 1019 completed

- Added portable versioned JSON export from Library settings
- Included source configuration, manual reading orders, confirmed metadata
  matches, browser progress/status, skipped chronology folders, selected view,
  and reader mode
- Excluded comic archives, regenerable indexes/covers, logs, and provider
  credentials
- Added restore validation and a count preview before replacement
- Preserved temporarily unavailable USB sources and started a quick scan after
  restore
- Added rollback of NAS-side settings if a restore write fails
- Changed chronology chips from raw folder ranks to larger branch-relative
  sequence numbers (`1`, `2`, `3`)

### 0.4 — Library Editing and Storylines

**Status:** in progress; stable shelf and bulk metadata completed in build 1023

**Estimated effort:** 3–5 weeks

- Metadata editor with manual overrides stored in PanelShelf.
- Series, volume, publisher, year, genre, writer, artist, and summary views.
- Storyline builder based on folders, metadata, or manual selection.
- Custom covers and banners stored in PanelShelf's private data directory.
- Duplicate detection and merge suggestions.
- Bulk edit, bulk add to storyline, and bulk rescan.
- Import/export reading orders as a portable PanelShelf JSON format.

### 0.4.1 — Metadata Editor — build 1021 completed

- Added durable manual overrides for title, series, issue, volume, publisher,
  year, format, storyline, creators, genres, tags, and summary.
- Manual overrides take precedence over inferred, embedded, and confirmed
  online metadata while leaving source archives untouched.
- Added reset-to-source behavior, backup/restore support, UI badges, HTTP API,
  OPDS propagation, and rebuild/restart regression coverage.
- Carried forward content-signature detection for mislabeled CBZ/CBR files.

### 0.4.2 — Focused Timeline — build 1022 completed

- Added a persistent Grid/Timeline visualization toggle to hierarchical
  chronology browsing.
- Added a numbered timeline rail, focused cover carousel, keyboard navigation,
  nested comic strip, branch entry, and skip controls.
- Added a prominent current publication year or year range with metadata-source
  provenance.
- Added scan-time fallback year inference for parenthetical filename forms such
  as `(2014)` and `(2006 MinuteMan)`.
- Kept filename inference separate and below embedded, confirmed online, and
  manual metadata in the precedence chain.
- Included the chosen visualization in portable browser-state backup/restore.

### 0.4.3 — Stable Shelf and Bulk Metadata — build 1023 completed

- Prevented progress-only reader and timeline interactions from rebuilding the
  complete shelf, eliminating the most visible cover/component flashes.
- Added a labeled reader Back button that returns to the unchanged underlying
  view and scroll position.
- Added branch-level chronology actions for start/continue, mark all unread,
  mark all completed, skip, and restore.
- Added a persistent background metadata job for unmatched comics using Smart
  fallback, pause/resume/cancel controls, and live results.
- Restricted automatic approval to candidates scoring at least 90 with a
  10-point lead over the runner-up; never replaces a confirmed match.
- Build 1024 hotfix: stabilized the native bulk-progress dialog during polling
  by reconciling keyed rows in place and disabling backdrop blur for that
  dialog only.

### 0.4.4 — PanelShelf Sync API

- First-party authenticated progress and shelf-status API for a future
  PanelShelf iOS client.
- Optimistic progress updates with conflict-safe timestamps and per-user state.
- No Komga compatibility adapter or third-party client impersonation.
- Keep read-only OPDS as a separate acquisition/catalog interface.

**Release gate**

- Manual edits always override inferred metadata.
- Full rebuild does not erase manual edits, covers, progress, or reading orders.
- Metadata parsing failures appear as warnings rather than dropping the comic.

### 0.5 — Accounts and Client Access

**Estimated effort:** 3–4 weeks

- Administrator setup on first launch.
- Multiple users with separate progress and reading lists.
- Session security, rate limiting, and password recovery.
- Add authentication to the read-only OPDS feed introduced in build 1018.
- Responsive tablet and phone improvements.
- HTTPS reverse-proxy documentation and trusted-proxy configuration.
- Exportable support bundle with version, sanitized configuration, and logs.

**Release gate**

- No library or page endpoint is accessible without authorization once accounts
  are enabled.
- The support bundle excludes passwords, session secrets, and comic contents.

### 0.9 — Synology Marketplace Candidate

**Estimated effort:** 3–6 weeks plus external review time

- Verify DSM 7.2 and 7.3 install, upgrade, stop/start, reboot, and uninstall.
- Verify x86-64 on the DS1825+ and representative Intel/AMD Synology models.
- Build and physically validate ARMv8 before declaring those models supported.
- Keep ARMv7 experimental unless a maintainable runtime passes hardware tests.
- Package signing, upgrade migrations, backup/restore compatibility, and
  rollback testing.
- In-app version information, documentation, privacy policy, EULA, and support
  contact.
- Replace the current open-source license before any private commercial beta if
  PanelShelf will remain proprietary.
- Decide paid model: one-time NAS license, paid major upgrades, or subscription.
- Add license activation with a reasonable offline grace period.
- Publish a precise supported-model matrix rather than claiming all DSM models.

**Release gate**

- Fresh install and upgrade tests pass from the last public beta.
- No package process runs as root.
- No critical or high-severity production dependency vulnerability remains.
- Recovery instructions exist for a failed upgrade.
- A nontechnical tester can install, authorize a USB share, add a source, scan,
  resolve an issue, and begin reading without developer help.

### 1.0 — Commercial Release

- Marketplace-approved package where available
- Direct signed SPK distribution as a supported fallback
- Stable documentation and support process
- License purchase, activation, transfer, and refund flow
- Public changelog and security-reporting channel
- At least one full release cycle tested through the updater

## Scanning test matrix

Every 0.2 build must test at least these layouts:

1. One loose CBZ at the source root
2. Multiple loose CBZ/CBR files with natural numeric filenames
3. One series per folder
4. Series with nested volume/arc folders
5. Marvel-style hierarchy with numbered eras, dotted insertion ranks,
   unnumbered universes, and underscore staging folders
6. DC-style era with family/group folders, loose comics, and numbered events
   beneath an unnumbered `Major Events` branch
7. Equal-rank timeline buckets such as several `00` folders
8. Flat exact reading order
9. Nested exact reading order
10. Exact order with missing or duplicate sequence positions
11. Hierarchical timeline beneath a confirmed publisher/imprint container
12. Mixed loose files and series folders
13. Files nested deeper than the selected profile permits
14. Unsupported layout indexed as unordered without a fabricated chronology
15. Empty folders, hidden folders, `.DS_Store`, and Synology `@eaDir`
16. Unicode, accented, punctuation-heavy, and very long names
17. Corrupt, password-protected, unsupported, and permission-denied archives
18. Permission denied on the source root, a child folder, and one comic
19. USB disconnect during and between scans
20. Reconnect at the same path
21. File rename, folder move, modification, and deletion
22. Two configured sources that overlap
23. Two different comics with identical filenames
24. Service restart during a scan
25. Upgrade from the legacy `libraryPaths` configuration

Tests must verify discovery, grouping, ordering, issue reporting, data
preservation, and read-only behavior—not only the number of files found.

## Priorities

### Must have before a paid beta

- 0.2 Library Structures complete
- reliable USB reconnect behavior
- consistent Scan Issues and recovery actions
- reading progress and manual chronologies
- backup/export of PanelShelf configuration
- no root execution and no source-folder writes

### Must have before marketplace submission

- accounts or an explicit safe first-run access model
- signed, upgrade-safe packages
- x86-64 hardware compatibility matrix
- ARMv8 only if physically validated
- documentation, privacy policy, EULA, licensing, and support bundle
- installation testing by users who did not build the app

### Later differentiators

- additional metadata providers and assisted cover matching
- recommendations and smart collections
- alternate editions and language grouping
- annotations and bookmarks
- family/child profiles
- native mobile clients
- optional remote relay service

## Immediate implementation order

1. **Done:** Freeze and archive the latest working 0.1 SPK/source snapshot.
2. **Done:** Add configuration schema v2 and migration tests.
3. **Done:** Implement deterministic path tokenization, integer/dotted-rank parsing,
   folder-role classification, and structure validation.
4. **Done:** Add publisher/imprint aliases, confidence scoring, and hierarchy
   classification.
5. **Done:** Add minimal `ComicInfo.xml` parsing for structure inference.
6. **Done:** Implement source records, supported-layout detection, the four organization
   profiles, and the unordered fallback.
7. **In progress:** Add more large-library fixtures and the full hardware
   scanning test matrix.
8. **Done:** Preserve last-known items when a source is unavailable.
9. **Done:** Split Quick Scan from Full Rebuild and add per-source/retry actions.
10. **Done:** Update source settings UI and Scan Issues to use the new source model.
11. **In progress:** Continue upgrade, reboot, USB reconnect, and large-library
    validation on the DS1825+.
12. **Done:** Add portable configuration, reading-order, metadata-match, and
    browser-state backup/restore with a preflight preview.

Finish the remaining large-library fixtures and DS1825+ regression passes
before a paid beta. Metadata editing, storylines, custom covers, bulk tools,
and reading-order import/export remain in 0.4.
