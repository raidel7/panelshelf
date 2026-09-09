# PanelShelf Roadmap

Updated: 2026-09-09

| Component | Version | State |
| --- | --- | --- |
| **Server and web** | 0.5.1, build 1043 | Released and installed. The developer's NAS runs it. |
| **iPad app** | unreleased | Developed separately. At parity with the web viewer for browsing and reading. |

PanelShelf is a native Synology DSM comics server for CBZ and CBR libraries. It
preserves the owner's folder structure and reading orders, supports internal and
external USB storage, and keeps everything it generates inside the package's
private data directory without altering the source comics.

This document covers the server, the browser reader, and the DSM package. A
first-party iPad client reads from the same server and is developed in its own
repository. It appears here only where it explains a server decision, because
the two blocked each other in both directions: the app is the reason the server
grew a progress API, a compact library listing, and cover thumbnails, and each
of those was built because a real iPad hit a real wall.

Time ranges are planning estimates for one primary developer, not release
commitments. Physical testing on Synology hardware remains the largest source of
uncertainty.

## Product principles

1. **Comic sources remain read-only.** PanelShelf never renames, moves, or
   modifies the user's archives.
2. **The user's organization is authoritative.** Folder hierarchy, numeric
   prefixes, manual reading orders, and explicit skip choices are intentional
   data.
3. **Metadata does not invent chronology.** ComicInfo and online providers may
   enrich a comic; they cannot silently change its reading order.
4. **USB libraries are first-class.** A disconnected source stays configured and
   keeps its last-known shelf data.
5. **Native installation stays simple.** No Docker, Java, or separately
   installed runtime.
6. **Failures must be actionable.** Every scan, permission, archive, or metadata
   problem belongs in a visible issue report with a recovery action.
7. **First-party sync stays first-party.** OPDS remains a generic read-only
   catalog; the iPad app uses a dedicated PanelShelf API, never a Komga
   compatibility layer.
8. **Do not expose an unsafe server.** LAN use comes first; authenticated remote
   use arrives before PanelShelf is marketed for internet access.

## Two clients, one library

The web viewer and the iPad app are peers over the same server. Anything that is
per-reader state — progress, status, skipped branches — belongs on the server so
both see it; anything that is per-device — sidebar width, reader fit, cover
caches — stays local.

Server-side reading progress (0.4.4) was the first piece of this and is the
model for the rest: the web viewer migrated its browser-local store into the API
once, behind a migration flag, and neither client is now the owner of the truth.

## Where things stand

### Server and web

The current build provides:

- Native non-root DSM package installation and launch integration
- Multiple internal-volume and external-USB comic sources
- Recursive CBZ/CBR discovery, cover extraction, search, and browser reading
- Single-page, double-page, manga, and continuous-scroll reader modes
- All Comics, Publisher, Chronology, Unfiled, and Timeline browsing
- Folder-derived and manual reading orders
- Unread, in-progress, completed, and skipped states
- Embedded `ComicInfo.xml` support and durable manual metadata overrides
- Optional smart online matching through GCD, Metron, and Open Library
- Bulk metadata matching with conservative automatic approval
- Quick Scan, Scan Source, Retry Issues, and Full Rebuild actions
- Read-only OPDS 1.2 catalogs, byte-range requests, and archive acquisition
- Portable settings, metadata, reading-order, and browser-state backup/restore
- Server-owned reading progress shared by every client
- mDNS service advertisement (`_panelshelf._tcp`)
- A compact library listing, a per-comic detail route, and cover thumbnails
- A windowed shelf that no longer rebuilds itself on every state change

### Shipped since build 1024

| Version / build | Delivered outcome |
| --- | --- |
| 0.4.4 / 1025 | Server-side reading progress and mDNS service discovery |
| 0.4.5 / 1026 | Discovery status endpoint |
| 0.4.6 / 1027 | Unsolicited discovery announcements for DSM's occupied port 5353 |
| 0.4.7 / 1028 | Removing a source clears its comics from the index |
| 0.4.8 / 1029 | The same fix applied to comics indexed before it existed |
| 0.4.9 / 1030 | `?view=compact` listing and `GET /api/comics/:id` — 71 MB to 5 MB |
| 0.4.10 / 1031 | Grid-sized cover thumbnails — 774 KB per cover to 51 KB |
| 0.4.11 / 1032 | Windowed shelf rendering and a preview that no longer blanks |
| 0.4.12 / 1033 | Arrival dates with `sort=added`, and progress deletions that reconcile |
| 0.4.13 / 1034 | Server-owned skipped collections, the chronology route, and imprint parents |
| 0.4.14 / 1035 | A request for a comic outside the index no longer stops the server |
| 0.4.14 / 1036 | A page turn stopped repainting every cover the shelf had drawn |
| 0.4.15 / 1037 | A cover cache that records itself, can be warmed in one pass, and is cleaned up |
| 0.4.16 / 1038 | Device pairing, a versioned API, and incremental library changes |
| 0.4.16 / 1039 | Library folders no longer opens empty over a configured library |
| 0.4.17 / 1040 | Storylines, chosen covers, order portability, duplicates, bulk editing |
| 0.4.18 / 1041 | OPDS page streaming, so third-party readers page instead of downloading |
| 0.5.0 / 1042 | Reader profiles, pairing-code limits, trusted proxies, support bundle, phone layout |
| 0.5.1 / 1043 | A cover cache with a ceiling, a bounded log, source health, upgrade checkpoints, scheduled scans, and a lighter shelf listing |

1043 is most of section 10: everything in it that can be built without a NAS.
What is left there needs hardware. The 0.4.14 heading covers 1035 and 1036 as
point fixes. The iPad client cannot pair yet — that is client work, and pairing
stays off until it can.

### Companion iPad app

A native iPad client is developed separately, in its own repository, and is not
part of this project's source. It speaks to this server over the documented
HTTP API and the OPDS catalog, and shares reading position through
`/api/progress/merge` — which is why that endpoint's contract is treated here
as public surface rather than an internal detail. Its own roadmap is tracked
alongside the app.

### Known gaps in the foundation

- Everything since 0.4.16 was written against a laptop, and 1043 is the first
  build to be installed. What that upgrade proved is in section 10; what it did
  not touch is everything that only happens under load or over time. No scan has
  yet run under this build on hardware, so the cover cache ceiling, the log
  rotation, the generation queue and the scheduled scan have all been installed
  and none of them has been exercised.
- The numbers behind the cover cache — 4 GB, two at a time, covers before
  thumbnails — are still reasoned rather than measured. Section 10.
- The support workflow exists on paper and has never been used by anybody but
  its author. Private reporting, a privacy policy, a supported-model matrix and
  a support bundle are all written; what is missing is the gate that matters —
  somebody who did not build this installing it, adding a source, and reading a
  comic without being helped.

## Library organization model

The interface avoids using “scan mode” for two different concepts. PanelShelf
separates:

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

### Remembered starting points in the folder browser

The browser opens at `/` every time and shows the volumes, so adding a second
folder from the same tree means walking back down
`/volumeUSB2/usbshare2-2/Marvel/…` by hand, once per folder. Someone filing a
publisher's run adds many folders in one sitting and pays that walk every time.

Remember the folders a source has actually been created from and offer them as
one-tap starting points at the top of the browser, most recent first. Not a
browsing history — that fills with half-walked paths nobody chose — but the
directories that were actually selected, plus their parents, which is where the
next sibling folder almost always lives.

Release gates:

- Adding a second folder beside one already in the library takes one tap to
  reach its parent, not a walk from `/`.
- A remembered path that no longer exists, or whose USB volume is unplugged, is
  shown as unavailable rather than opening onto an error.
- Removing a source does not remove its starting point; the folder is still
  where the next one is likely to be.

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

## Delivery sequence

Server milestones continue from 0.5.0. The numbers 0.4.4 through 0.4.18 are
spent, and so is 0.5.0; anything planned takes 0.5.1 or later. 0.4.18 was not a planned
milestone: it answers the question of how anyone reads comfortably on an iPad
while the first-party client is still unreleased. Section numbers are stable
identifiers and are referenced elsewhere in this document, so the gaps below
are deliberate — those milestones belong to the iPad client and moved with it.

| # | Milestone | Status | Planning range |
| --- | --- | --- | --- |
| 5 | 0.4.15 — Offline shelf and cover cache | **Done** — 0.4.15 | — |
| 6 | 0.4.16 — Sync API hardening | **Done** — 0.4.16 | — |
| 7 | 0.4.17 — Storylines and advanced library editing | **Done** — 0.4.17 | — |
| 8 | 0.5 — Reader profiles and secure deployment | **Done** — 0.5.0, untested on hardware | — |
| 10 | 0.7 — Reliability, performance, administration | **In progress** — all that is left needs a NAS | 3–5 weeks |
| 11 | 0.9 — Distribution candidate | In progress — the writing is done, the hardware is not | 2–4 weeks |
| 12 | 1.0 — Public release | Planned | After the gates above |

---

## 5. 0.4.15 — Offline shelf and cover cache — server

### Goal

Keep the visual library usable when a USB disk is asleep, disconnected, or slow
to wake. Reading an unavailable archive stays disabled; looking at the shelf
does not.

### Scope

Complete, released as 0.4.15-1037.

- Consult the cover cache before opening the source archive — 55079b0.
- Persist each cached cover's filename, content type, dimensions, and source
  fingerprint. In `covers.json` rather than the library index: the scan rebuilds
  comic records from disk, so index-resident cache state has to be carried
  across every scan by hand, and forgetting once silently regenerates every
  cover.
- Serve cached covers for unavailable comics rather than omitting the image —
  55079b0.
- A background **Cache all covers** action with progress and cancellation, so
  thumbnails are not generated one scroll at a time on NAS CPU.
- Cache status and approximate storage use in Library settings.
- Invalidate and regenerate a cover when the archive fingerprint changes. The
  scan already fingerprints each file's contents to detect moves, so this costs
  a string comparison against a value already in memory — no stat, no archive.
- Preserve the cache across service restarts and compatible upgrades. Restarts
  by construction; upgrades because the data lives in `SYNOPKG_PKGVAR`, which
  DSM preserves, and all three upgrade scripts are no-ops.
- Drop cache entries and files for comics that have left the library, wherever
  the enrichment store is reconciled. Not in the original scope; without it the
  storage figure above counts covers for comics that are gone.

### Release gates

- After a scan and cover warm-up, disconnecting the USB disk leaves covers and
  metadata visible.
- Serving a cached cover does not touch the comic archive. **Met** in 55079b0.
- Reconnecting the disk restores reading without creating duplicate comics.
- A changed archive cannot indefinitely retain an unrelated old cover. **Met**:
  the integration test replaces an archive in place and restores its original
  mtime, so nothing but the fingerprint can catch it.
- Cache cleanup never removes a source comic.

## 6. 0.4.16 — Sync API hardening — server

Complete, released as 0.4.16-1038.

### Goal

Turn the endpoints the app grew into a stable, versioned, authenticated
contract, while OPDS stays a separate read-only catalog standard.

### Scope

- Version the JSON API. `/api/v1/…` is an addition, never a replacement: the
  prefix is normalised off before anything reads the path, so a versioned
  request meets the same guards rather than a parallel set. The iPad client
  ships from its own repository, so moving the paths was never available.
- Device-token creation, revocation, expiry, and last-used reporting, so pairing
  never means pasting a long-lived password.
- An incremental library-change endpoint, so a client does not re-download the
  whole catalog to learn that one comic moved.
- Conflict-safe progress writes: keep the existing split where `PUT` and
  `/batch` are deliberate server-stamped writes and `/merge` is reconciliation,
  and document it, because a user action sent through `/merge` can be discarded
  with a 200.
- Stable comic and reading-order identifiers across safe rescans and moves.
  Already true — the scan carries an id through `identity`, and matches a moved
  file by the fingerprint of its contents. Now covered by a test that saves a
  bookmark, rescans, moves the comic, and requires the bookmark to survive both.
- Explicit unavailable-source and offline-cache states for clients. Already
  carried as `available` on each comic, with a disconnected source keeping its
  last-known comics rather than emptying the shelf.
- API documentation and a small conformance suite: `npm run conformance`, aimed
  at a running server, read-only unless asked otherwise.

### Non-goals

- No Komga API emulation, no third-party client impersonation. Standard
  extensions are a different thing and are welcome: OPDS Page Streaming shipped
  in 0.4.18 so third-party readers can page through a comic instead of
  downloading it whole, which is compatibility by publishing to a standard
  rather than by pretending to be somebody else's server.
- No write-back into CBZ or CBR archives.

### Release gates

- Progress written by one authorized client appears consistently in the other.
- A stale client write cannot silently replace newer progress.
- Revoked credentials lose access immediately. **Met**: revoking drops the
  token's hash, so there is nothing left to match on the next request.
- A rescan does not break client bookmarks for unchanged comics. **Met**, and
  for a moved comic too.

## 7. 0.4.17 — Storylines and advanced library editing — server and web

Complete, released as 0.4.17-1040, server and web both.

Bulk editing acts on the current search rather than on a hand-picked selection.
The job it exists for — fixing a publisher or a series name across a run — is a
filter, and selection state over a shelf that draws ninety-six of twenty-five
thousand cards is a great deal of machinery for something that rarely needs
individual picks. A selection over a thousand comics is refused rather than
truncated: half an edit is worse than none, and nothing on screen would say
which half.

### Scope

- Storyline builder from folders, metadata, or manual selection.
- Custom covers and banners in PanelShelf's private data directory.
- Bulk metadata editing and bulk storyline assignment.
- Duplicate detection with reviewable merge suggestions.
- A match review queue for low-confidence or ambiguous online results.
- Reading-order import and export in a documented PanelShelf JSON format.
- Manual order repair for missing, duplicate, or moved entries.
- Metadata provenance display: filename, ComicInfo, provider, manual.

### Release gates

- Manual edits always override inferred and provider metadata.
- Full rebuild does not erase manual edits, custom artwork, progress, or
  reading orders.
- Duplicate suggestions never delete or merge source files automatically.

## 8. 0.5 — Reader profiles and secure deployment — server

Accounts were the plan here and are no longer. The server holds one library, in
whatever arrangement the drive already has, for one household. Usernames and
passwords would put a login in front of a machine sitting on the owner's own
LAN, and per-user shelves would fragment a library whose whole premise is that
the owner's folder structure is authoritative. Device pairing, shipped in
0.4.16, already does what the security gate was for: `authorize()` refuses
every `/api/` route and the entire OPDS catalog to an unpaired caller.

Two people reading different comics is a client concern, the way it is in Plex
and Netflix. The iPad app owns reader profiles: creating them, naming them, and
switching between them. The term is written in full every time it appears,
because an *organization profile* elsewhere in this document means how a source
is arranged on disk, and the two have nothing to do with each other.

The server's share is small but not zero. Of the thirteen files in the data
directory, exactly two hold per-reader state, and both are a single flat
namespace today:

- `progress.json` — comic id to record. Two reader profiles against that map
  would show each other's shelves and each other's completed marks, since
  unread, in progress, and completed all derive from it.
- `skips.json` — which chronology branches a reader set aside. A branch one
  person hides would vanish for the other.

Those two gain a reader-profile dimension. Nothing else does: sources,
metadata, reading orders, storylines, artwork, devices, and the index itself
stay single and shared, because they describe the library rather than the
reader. That split is the whole design, and it is the same one Plex draws — one
server, one library, watch state per profile, any client picking it up.

A device token is the wrong key for this — one iPad, two reader profiles, one
token — so the reader-profile id is chosen by the client and sent explicitly.
It is a namespace, not an identity: it authenticates nothing, and pairing
remains the only thing standing between the library and a stranger.

Third-party OPDS readers cannot send a header PanelShelf invents. That sounds
like it conflicts with the paragraph above, and it does not: the client that
holds several reader profiles is the first-party app, which can name one, and
the clients that cannot name one are single-person apps on a single device,
which never need to. Each side is solved by the thing it already has.

The catalog is also the smaller half of the problem. OPDS reads progress — the
feed advertises `pse:lastRead` and `pse:lastReadDate` — but nothing in the
OPDS or page-streaming routes writes any back, so a third-party reader cannot
overwrite anyone's place. What it can get wrong is whose shelf it displays.

A reader profile therefore resolves in three steps, first match winning:

1. **Named explicitly.** First-party clients send the id outright. An OPDS
   reader puts the reader-profile name in the Basic *username* field, which
   `presentedToken` already decodes and throws away today, and which every one
   of these readers puts a box on screen for. Password stays the device token.
   No extension, no invented header — the credential form the client already
   shows is the one that carries it.
2. **Bound to the device.** A paired device may be bound to a reader profile
   when it pairs or afterwards in the web UI. A token that names nothing
   resolves to its device's profile. This is why the device token is a poor
   key but a good default: an OPDS reader is one app on one person's device,
   even when the family's iPad is not.
3. **Default.** No name and no binding resolves to the default reader profile.
   That is what keeps the upgrade from 0.4.18 silent, and what a client with
   no credential fields at all still gets.

For a reader that offers neither a username nor pairing, a per-reader catalog
URL — `/opds/r/<name>` — carries the same information in the one field every
OPDS client has, the address of the catalog itself.

### Scope

Built:

- Reading progress and skipped branches namespaced by reader-profile id, with
  existing records migrating into a default reader profile so nobody loses
  their place or their hidden branches.
- Reader-profile listing, creation, renaming and deletion on the server, so a
  client can offer the switch and clean up after one nobody uses. Deleting one
  takes its shelf and unbinds whatever pointed at it.
- Reader-profile resolution from the Basic username, a bound device, or a
  per-reader catalog URL, so a third-party OPDS reader sees one person's shelf.
- An optional reader-profile binding on each paired device, set when it pairs
  or afterwards from the owner's browser.
- Backups carrying every reader profile at schema 1, so a 0.5 backup still
  restores on 0.4.18 rather than being refused by it.
- The web side of all of the above: naming the readers, saying which one this
  browser is, and binding a device to one.
- Rate limiting on pairing-code redemption: ten wrong codes from one caller or
  a hundred from everyone, per fifteen minutes, then `429` with a `Retry-After`.
  Callers are counted by IPv6 prefix rather than by address, because a single
  host owns a whole /64. A fresh code clears the count, and generating one is
  guarded once pairing is on, so only somebody already paired can do it.
- `X-Forwarded-For` and `X-Forwarded-Proto` honoured from an address named in
  `PANELSHELF_TRUSTED_PROXY`, and from nowhere else. With it set, pairing
  attempts are counted against the caller the proxy reports rather than the
  proxy, and the device cookie is marked `Secure` on a request that reached the
  proxy over HTTPS. Both defaults have to be the untrusting one: a `Secure`
  cookie is never sent over plain HTTP, and a forwarded address from an unnamed
  source is a value the caller chose.
- Reverse-proxy and HTTPS documentation, with working DSM Application Portal,
  nginx and Caddy configuration. The DSM service script reads `PANELSHELF_`
  settings from `panelshelf.env` beside the data, since the package directory is
  replaced on every upgrade — parsed rather than sourced, because the server
  writes to that directory itself.
- An exportable support bundle: versions, configuration, source arrangement and
  reachability, counts, device names, and the tail of the log. No device token
  or its hash, no provider key — not even the masked hint the settings page
  shows — no page, cover or archive listing, and no record of what anyone has
  read. Source paths are included, because they are the subject of most of what
  goes wrong, and the file opens by saying so.
- Responsive tablet and phone layout: a breakpoint for an iPad, one for a small
  phone, and one for a phone held sideways, which is the position a comic is
  actually read in. `dvh` beside every `vh`, so the reader's toolbar stops
  hanging behind a phone's address bar, and `viewport-fit=cover` with safe-area
  padding on everything that touches an edge.

Still to do:

- Nothing. The section is code-complete and has not run on real hardware.

### Release gates

- With pairing on, no library, page, acquisition, or progress endpoint is
  anonymously accessible.
- Two reader profiles never receive each other's reading state or each other's
  skipped branches. Everything else about the library is shared on purpose.
- Upgrading from 0.4.18 leaves existing progress and skips intact under the
  default reader profile. A client that names no reader profile and is bound to
  none still reads and writes exactly what it did before.
- A wrong or unknown reader-profile name never creates a profile. It is treated
  as though no name were given, falling through to whatever the device is bound
  to and to the default after that, so a typo in an OPDS client's username box
  cannot silently strand somebody's shelf where nothing can find it.
- Backup and restore carry every reader profile's progress and skips without
  exporting a reusable device token.
- A support bundle contains no device token, no token hash, no provider key,
  and nothing about which comics anyone has read.
- Turning a proxy's forwarded headers on is an explicit act. Unset, they are
  ignored however well formed they are.
- The reader fills a phone's visible viewport, not the taller one it reports
  with the address bar hidden.

## 10. 0.7 — Reliability, performance, and administration — server

### Goal

Everything here is about what the server does when it is not being watched: a
library four times bigger than the one it was written against, a disk that fills
up, a scan that runs at three in the morning. The work of the earlier milestones
was making features exist. This is making them keep working.

### Scope

- Thumbnail generation queue limits and storage quotas.
- Large-library profiling at 5,000, 25,000, and 100,000 comics.
- Index migrations with automatic rollback checkpoints.
- A source health dashboard for disconnected, slow, permission-denied, and
  corrupted archives.
- Scheduled scanning, metadata matching, and cache maintenance.
- Log rotation and one-click sanitized diagnostics.
- Dependency and package vulnerability review.
- Upgrade, downgrade, restart, and unexpected-power-loss testing.

### Done

- **Cover cache ceiling and generation limit.** `covers/` had no bound and
  nothing limited how many covers were generated at once, which are two versions
  of the same problem: derived data with no ceiling. The cache now has a byte
  budget (`PANELSHELF_COVER_CACHE_MB`, 4096 by default, `0` to remove it) and
  gives up full covers before thumbnails, coldest first — the reverse of what a
  plain least-recently-used cache would do, because a thumbnail is fifteen times
  smaller and is wanted on every card drawn, while a full cover is one detail
  view. Generation runs through a queue (`PANELSHELF_COVER_CONCURRENCY`, 2 by
  default) that also answers duplicate requests with one decode, so a warm-up
  and a reader on the same shelf no longer open the same archive twice.
- **Log rotation and one-click sanitized diagnostics**, the whole line. The
  bundle arrived early, in section 8. The log now has a ceiling
  (`PANELSHELF_LOG_MAX_MB`, 8 by default): past it the file is copied to
  `panelshelf.log.1` and emptied in place, so the pair can never occupy more
  than twice the cap. Emptied rather than renamed, because the package starts
  the server as `node server.js >> panelshelf.log 2>&1` — the shell owns the
  descriptor, and that is worth keeping, since it is what puts a crash and a V8
  fatal error in the same file as the ordinary lines. A rename would leave the
  shell writing to the renamed file and the live log empty for good. The
  design depends on that redirect staying append-only, which fails silently, so
  a test reads the start script and asserts it.
- **Scheduled scanning and cache maintenance.** `GET`/`PUT /api/schedule` and a
  panel in Library settings: a time of day, a scan action, and optionally
  caching every cover once the scan has settled. A time rather than an interval,
  because an interval lands in the middle of an evening eventually. Polled once
  a minute rather than slept until, which is the only version that survives a
  machine that hibernates or has its clock corrected — a missed hour is caught
  up the same day and never across days. Metadata matching is offered and
  defaults off, because it calls third-party providers and a timer that spends
  somebody's rate limit overnight should be something they chose.
- **Dependency and package vulnerability review.** One production dependency,
  `node-unrar-js` 2.0.2, which is current; `npm audit --omit=dev` reports
  nothing. The bundled Node runtime moves to 22.23.2. It stays on 22 for a
  reason worth writing down: **Node 24 ships no `linux-armv7l` build**, so
  moving to it would quietly leave the ARMv7 package without a runtime. 22 is
  the last line carrying 32-bit ARM and is supported to April 2027, which is
  also the date by which the ARMv7 package needs a decision rather than a
  default. Also found: `server/package.json` is copied into the installed
  package and had drifted three releases behind, so a test now asserts it
  matches.
- **Index migrations with rollback checkpoints.** `library.json` now carries a
  `schemaVersion`, and before any migration writes, everything a scan cannot
  rebuild is copied to `checkpoints/<when>-<why>/` — the index has been
  reshaped twice already and both times the upgrade was a one-way door. Both
  startup migrations are read before either is written, so one checkpoint covers
  both. An index from a newer build stops the server instead of being rewritten
  at the older shape, because a downgrade that appears to work and silently
  drops what the newer version added is the worst of the available outcomes.
  Nothing restores automatically: a checkpoint is a copy of what was there, kept
  where somebody can find it, not a machine for undoing a migration whose
  meaning it does not know.
- **A source health dashboard**, `GET /api/sources/health` and a panel in
  Library settings. Each source reports the worst thing true of it —
  `disconnected`, `unreadable`, `damaged`, `slow`, `ok` — with what it holds,
  what in it will not open, and what the last scan of it cost. The four
  dimensions the scope asked for, from state the server already has: nothing
  here walks the disk. Scan issues are attributed to the source being walked
  when they happen rather than matched by path afterwards, because one source
  configured inside another makes a prefix match pick the wrong one.
- **The issue list groups by folder, because that is the diagnosis.** The panel
  above says a source is damaged and how many files are involved; the list
  behind it named them, one row each, in walk order. On the developer's library
  that is 28 rows that all look alike — and twelve of them were consecutive
  issues in a single Superman folder, which is one bad download rather than
  twelve bad files. `GET /api/sources/issues` groups by the folder a file sits
  in, largest group first, and reports `files` against `comics` so a ruined
  volume reads differently from a volume with a bad file in it. Counts are
  exact and lists are bounded, the same contract the listing's `limit` has: a
  library with four thousand broken files still says four thousand. Errors that
  never became a comic have no record to group by and are listed on their own
  rather than dropped.
- **A file that will not open stays reported.** Found while testing the panel
  above: a broken archive was reported once and then disappeared from the issue
  list on the very next quick scan, because a quick scan does not reopen an
  archive it has already seen. The file had not healed — nothing had looked at
  it. It was still on the shelf with no pages, and Retry issues no longer
  offered it. The verdict now lives on the comic's record, survives a restart,
  is re-reported on every scan that does not reopen the file, and clears the
  moment it opens.
- **Two ceilings on what the index costs to write.** The whole document was
  built as one string and copied into a buffer to be written: at 100,000 comics
  that is 180 MB of string and 180 MB of buffer alive at once, on top of the
  records they came from. Records now go out in blocks and nothing bigger than a
  block is held. Indentation went with them — nobody reads a hundred thousand
  records by hand, and it was 31% of the file. Peak resident set during a scan
  fell from 1,664 MB to 1,036 MB, the index from 183.6 MB to 126.7 MB, and the
  scan is no slower.
- **The library listing is streamed rather than assembled.** Answering
  `GET /api/comics` built an array of every projected record, serialised it to
  one string, and copied that into a buffer — three copies of the same answer to
  serve one request. Now projected and written a block at a time: 115 MB of
  extra resident set per request at 25,000 comics became 49 MB, at the same
  speed. The response is chunked, which costs a `Content-Length` only a progress
  bar wanted.
- **A quadratic in the scanner, found by the profile above.** Move detection
  asks whether a candidate's old path is still there, once per file for every
  comic sharing its fingerprint — a synchronous `existsSync` each time, holding
  the event loop. In a library carrying several copies of one archive (a rescued
  download, a backup folder beside the originals) that is quadratic: a rebuild
  of 4,000 identical files took 33.8 s and 3,600 stat calls per 60 files. A file
  that already has a record cannot be one that moved, so the search does not
  belong on that path at all. Now 1.0 s for the same 4,000, and a full rebuild
  costs what a quick scan costs. The regression test counts syscalls rather than
  seconds.
- **A reader that cannot be got stuck in.** Tapping a comic while the server was
  unreachable opened the reader onto "Loading page…" and left it there: `fetch`
  has no timeout of its own, and neither does an `<img>`. The worst case is not
  an unreachable host — that fails eventually on its own — but a server that
  accepts the connection and never answers, which is what a NAS wedged on a
  disconnected drive looks like from outside. Every request now has a backstop,
  the loading state says what is happening and offers a way out, and backing out
  abandons the request instead of leaving it running. Product principle 6 with
  the reader included: a failure nobody can act on is the one that matters.

- **The listing the browser actually downloads**, which was the larger half of
  what the profile found. A comic carries five metadata blocks — the merged one
  the interface draws, and the four inputs it was merged from — and the web
  viewer was being sent all five, because it builds its own chronology and so
  cannot use the compact list, which drops `hierarchy` and `orderPath` along
  with everything else. `?view=shelf` is the full record without those four
  inputs: **268.0 MB to 159.4 MB at 100,000 comics**, 67.0 to 39.8 at 25,000.
  `embeddedMetadata` and `sourceMetadata` are 19.3% of a listing each, and
  `metadata` is a third near-identical copy of the same block — three copies of
  one answer, on a wire, to draw a grid of covers. The four are read by the
  metadata dialog, which is one comic at a time and already had a route of its
  own to fetch them from; it now uses it. What they were read for on the list
  path survives as two small fields: `metadataSources` already named which
  inputs a comic has, which is what the badges wanted, and `yearSource` names
  the one that supplied the year, which `metadataSources` cannot — a
  ComicInfo.xml with no `<Year>` still puts `comicinfo` in it. The default
  listing is unchanged, so the iPad app is untouched and can adopt the shape
  when its own repository is next open.
- **Large-library profiling**, and the quadratic it found. `npm run profile
  <count>` builds a synthetic library shaped like a real one and measures the
  scan, the index, a restart, and the three listing shapes. Numbers below.
  The corpus now carries a ComicInfo.xml in two thirds of its archives, which
  it did not when the first numbers were taken — that omission is what made
  the metadata blocks look cheap, and every figure below moved when it was
  fixed.

### Still to do

The scan's gigabyte, and then hardware.

A tagged corpus costs 1,262 MB at the scan's peak on a laptop, against 1,036 MB
for the untagged one the first profile used. A rebuild holds the previous index
and the new one at the same time, by design, because that is what lets a comic
that moved keep its identity, and unpicking that means either giving up move
detection or reading the index a record at a time.

Hardware has now had its say and it argues for doing neither yet. A real scan of
24,839 comics peaked at 339 MB, less than half what the laptop projected at that
size, on a machine with 8 GB. The projection that matters is still the one at
100,000 comics on a 2 GB ARM model, and it is still a projection — but it is now
a projection anchored to a measurement that came in low, and rewriting the
rebuild on the strength of it would be optimising against a number that has
never been observed. The thing to do is measure a bigger library, not rebuild
the index.

The rest is hardware, and most of it is now done. The upgrade was made and
survived with a checkpoint, the read path was profiled against a real library,
both a full scan and a quick one have run under this build, the cover cache was
driven into its ceiling and shed exactly what it was written to shed, and the
package has now been stopped and started on the machine — with what they cost,
and the two things they disproved, recorded below. What is left is a downgrade,
power loss, uninstall, and the one part of this section that has still not shown
itself under pressure: the log reaching its own ceiling.

Everything in this section that can be built from a laptop is built.

### What a large library actually costs

Measured on a laptop, so these find algorithmic cliffs rather than NAS seconds.
Two thirds of the archives carry a ComicInfo.xml, which is roughly what a tagged
library looks like.

| | 5,000 | 25,000 | 100,000 |
| --- | --- | --- | --- |
| Scan | 2.1 s | 12.6 s | 57.4 s |
| Scan rate | 2,363/s | 1,989/s | 1,743/s |
| `library.json` | 9.0 MB | 45.0 MB | 180.1 MB |
| Restart | 0.07 s | 0.31 s | 1.43 s |
| Compact listing | 0.8 MB | 4.2 MB | 16.9 MB |
| Shelf listing | 8.0 MB | 39.8 MB | 159.4 MB |
| Full listing | 13.4 MB | 67.0 MB | 268.0 MB |
| Peak resident set, scan | 233 MB | 720 MB | 1,262 MB |

Nothing in the ordinary path is quadratic, which is the thing worth knowing. The
scan rate is not quite flat, though — it falls about a quarter across a
twentyfold range, where the untagged corpus held 3,200/s throughout. That is
worth watching rather than acting on: the work per comic is genuinely higher now
that every archive is opened and its ComicInfo parsed, and a decline that mild
over 20× is not a cliff. A restart of the largest library takes under a second
and a half.

Every figure here is larger than the first profile's, and the reason is the
corpus rather than the code: it had no ComicInfo.xml at all, so it understated
every metadata block and overstated the structural fields. The index went from
126.7 MB to 180.1 MB on the same 100,000 comics, and the full listing from
113.3 MB to 268.0 MB. Nothing regressed; the earlier numbers were measuring a
library nobody has.

A gigabyte and a quarter at 100,000 comics is more than the smallest ARM models
have. The listing is the part that got better — the browser now asks for 159.4
MB where it asked for 268.0, and a client that draws no hierarchy can have 16.9.

### What the hardware said

1043 is the first build installed on the NAS. A DS1825+ with one source, 24,839
comics on a USB disk, upgraded from 0.4.16-1038.

The upgrade itself did what it was written to do. The index migrated from
version 1 to version 2, and before it wrote anything it copied `config.json`,
`library.json`, `progress.json`, `online-metadata.json` and `changes.json` to
`checkpoints/2026-09-06T03-06-19-625Z-index-v1-to-v2/`. Five files rather than
eleven, because the other six do not exist on that install — no reader profiles
had been made, no reading orders, no manual metadata, nothing paired — and the
checkpoint copies what is there instead of failing on what is not. Every comic
was on the shelf afterwards, and the conformance suite passes 25 of 25 against
it.

The listing sizes land close to the synthetic corpus, which is the first
evidence that the corpus is honest:

| At ~25,000 comics | Synthetic | The real library |
| --- | --- | --- |
| Compact listing | 4.2 MB | 4.8 MB |
| Shelf listing | 39.8 MB | 44.2 MB |
| Full listing | 67.0 MB | 69.4 MB |

Real records run a few per cent larger than modelled ones, and the shelf saves
25 MB of the 69 on every load — 3.26 s down to 1.93 s over the LAN. Time to
first byte is 19 ms for a 69 MB response, which is the block-at-a-time writing
doing what it was for.

Two things the corpus still has wrong, in opposite directions. It gives two
thirds of its archives a ComicInfo.xml; the real library has one in 30% of them,
so the metadata figures above are an overstatement rather than the
understatement they were before. And it is on an SSD.

That last one is the finding that matters, and it survived being measured.

### What a scan costs on the machine that has to do it

A full scan under 1043: **24,839 files in 45.7 minutes, 9.1 a second.** The same
library under 1038 in August managed 9.2. The rebuild fix bought nothing here,
and that is not a disappointment — it removed a quadratic that only appears in
libraries carrying many byte-identical archives, and this one does not carry
them. What is left is the floor: opening 24,839 archives on a USB disk, which
the laptop models at 1,989 a second and hardware does at nine.

A quick scan of the same library: **9.3 seconds, 2,679 files a second**, no
archive opened, and all 28 unreadable files re-reported from their own records
rather than from the scan that found them. That is the durable-verdict fix
working on hardware, and it is the difference the whole incremental path exists
to make — 45 minutes against nine seconds.

| | Laptop, synthetic | This NAS, real |
| --- | --- | --- |
| Full scan | 1,989/s | 9.1/s |
| Quick scan | — | 2,679/s |
| Peak resident set | 720 MB | 339 MB |
| Reads during a scan | — | 0.24–0.7 s, worst 7.9 s |

Peak memory is the surprise, and it is a good one. The laptop projected 720 MB
at this size; hardware used 339, climbing steadily from 217 and never spiking.
This NAS has 8 GB and eight cores, so the gigabyte-and-a-quarter the laptop
projects at 100,000 comics is comfortable here. That figure was always a worry
about the small ARM models rather than about this machine, and it still is.

Reading stayed possible throughout, which is the release gate. The compact
listing answered in a quarter to seven tenths of a second for most of the scan,
with two excursions to 6.8 and 7.9 seconds. Degraded, never unresponsive, and
worth watching rather than fixing: both spikes came while the disk was busiest.

Two hypotheses died here, which is the point of running it.

Half the library is CBR — 12,191 against 12,648 CBZ — and the profile corpus is
entirely CBZ, so the RAR path had never been profiled at all. Cold cover
generation over fifteen of each says the format does not matter: 0.476 s for a
CBZ, 0.472 s for a CBR. The cost is the disk and the JPEG, not the container.
The corpus gap is real for coverage and irrelevant for speed.

And the source health panel's slow threshold was wrong in both directions. It
was 20 files a second for every scan, reasoned from "a NAS with spinning disks
still manages hundreds". A healthy full scan does nine, so the panel would have
called this library slow every time it finished reading itself; a quick scan
does 2,679, so it would have had to degrade 134-fold before the panel said
anything. There are now two floors, 2 and 200, each set well under its measured
rate.

A scheduled scan has also now fired on its own, which is the other thing in
this section that only a real machine can prove. Set two minutes out, it ran 37
seconds after the appointed minute — the poll is once a minute and lands where
the process started — took its 9.1 seconds, stamped itself, and moved to
tomorrow. Nobody asked it to.

That test turned up something worth more than the test. **The NAS keeps its
clock seven hours behind the laptop that configures it**, and the schedule is
set in the NAS's local time, which is right: it is the clock the library lives
on. But the control is a browser time input, which reads as this device's
clock, so an owner setting 03:00 would have got a scan at 06:00 their time and
no way to tell from the screen. The summary now says so, derived rather than
asked for — `nextRunAt` is the instant the NAS's clock reaches the time typed
in, which is enough to work out the gap — and says nothing at all when the two
clocks agree, which is the usual case.

### The cover cache reaching its ceiling

Warmed from cold against the real library, and it is the test that changed what
the ceiling means. A cover costs about 0.89 MB and its thumbnail about 44 KB,
so this library wants roughly 22 GB of full covers and 1.1 GB of thumbnails.
The budget is 4 GB. That is not a safety margin with room to spare, it is the
operating condition: 4 GB holds every thumbnail this library will ever need,
plus full covers for about 14% of it.

Which is exactly the case the eviction order was written for, and it did what it
says. The cache climbed to 4,076 MB against its 4,096 MB budget without ever
crossing it, and then, in the minute it reached the ceiling:

| | Before | After |
| --- | --- | --- |
| Thumbnails | 4,594 | 4,717 |
| Full covers | 4,603 | 4,049 |
| Bytes | 4,076 MB | 3,810 MB |
| Evicted | 0 | 677 |

Thumbnails kept being made while full covers were given up underneath them.
The shelf stays drawn and a detail view pays for itself again — which is the
trade the cache was built to make, now made under real pressure rather than
under an 8 MB ceiling on a laptop.

Two other things it showed. The warm-up runs strictly one comic at a time while
the generation queue allows two, so it uses half the capacity it could and takes
about 2.3 hours for a library this size at 2.24 comics a second. That reads like
an accident and works like a decision: the spare slot is what kept the compact
listing answering in 0.3 to 1.0 seconds through 35 minutes of continuous
decoding. Doubling it would halve the wait and spend the headroom that made the
shelf usable while it waited. Left alone deliberately, and now written down as a
choice rather than a default.

That reasoning was right about the symptom and wrong about the cause, which
the next section is about: the listing was slow because the decode was holding
the event loop, not because the queue was full. Once the decode moved off the
loop the trade disappeared, and the spare slot stopped being the thing keeping
the shelf usable.

And the queue never went more than one deep — peak depth 1, nothing coalesced —
because a serial producer cannot make it. The coalescing path that stops a
warm-up and a reader decoding the same archive twice is therefore still
unexercised on hardware; it has unit tests and no field evidence.

Still not reproduced on hardware: log rotation, power loss, downgrade, and
uninstall.

### Why a fresh branch took ten seconds to draw

Reported from the browser on 2026-09-07: covers take a long time to appear when
moving in and out of chronology branches, with the reasonable guess that
something was not being cached. Measured against the real library, the caching
was fine and the guess was wrong in an instructive way.

The same branch of 30 thumbnails, twice in a row: 6,225 ms cold, 91 ms warm.
Nothing was failing to cache. What was true instead is that 4,959 of 24,839
comics had a thumbnail at all — the other 80% had simply never been asked for —
and building one costs about a second.

The second measurement is the one that mattered. Sampling `/api/health` while
24 cold covers were generated: 4 ms median idle, 94 ms median during, **8.7
seconds at the 95th percentile**. The server was not slow at making thumbnails
so much as unable to do anything else while it made them. `createThumbnail`
decodes, scales and re-encodes synchronously in pure JavaScript, so every cover
held the event loop for its whole duration, and a branch asks for about twenty
at once.

This also explains the earlier finding above. The generation queue's limit of
two was written as a memory ceiling and defended as leaving headroom for the
shelf, but it could never have bought throughput: the CPU work was serialized
by the loop no matter how many were in flight.

Thumbnails now build on worker threads, sized for the machine — one per
gigabyte of RAM, one fewer than the core count, capped at four, started on
demand and given back after thirty seconds of quiet. On one machine, same
21-cover branch, everything else equal:

| | Main thread | Worker pool |
| --- | --- | --- |
| 21 cold thumbnails | 3,282 ms | 1,125 ms |
| Per cover | 156 ms | 54 ms |
| Event-loop turns during | 26 of 164 | 53 of 56 |

The pool cost one nightly build before it settled, and the failure is worth
recording because of how it presented: 507 passing, 0 failing, 32 cancelled.
Nothing had asserted anything wrong. A test process had exited while tests were
still pending.

Worker threads are unref'd so an idle server does not hold the process open.
Left unref'd while one is *working*, an awaited thumbnail is dropped outright —
the loop drains, the process exits 0, and the promise never settles. The
running server never noticed, because an HTTP listener holds the loop open by
itself; under `node --test` each file is its own process with no listener, so
whichever file was awaiting a cover when its loop went idle took the rest of
its tests down with it.

It did not reproduce locally in any configuration, which is the useful part: the
mechanism reproduces in four lines outside the test runner, and the regression
test therefore runs in a child process, because the runner's own handles are
exactly what hides it. A worker is now ref'd while it carries work.

Not yet measured on the NAS itself, which is where the 8.7-second figure came
from and where the pool will be four threads rather than this laptop's four
against a faster core. The remaining half of the answer is coverage: a full
warm-up is the thing that makes a first visit to a branch cost nothing, and it
is now a background job that does not hold the server while it runs.

### Opening the library inside DSM

Asked on 2026-09-09: is there a Synology app that reads CBZ and CBR on the box,
and can we open the library inside DSM rather than in a tab of its own.

There is no first-party one and there is not going to be — Synology has been
retiring media packages, not adding them, and DSM offers no way to register a
handler for a new file type, so File Station will never learn what a `.cbz` is.
Universal Viewer opens one, but as an archive: a file list, not pages.

The second half was already most of the way there. The package has always put
an icon in the DSM main menu; it was declared `type: "url"`, which is Synology's
name for the behaviour that throws the browser into a new tab. Their other value
is `legacy`, which draws the app in a window on the DSM desktop, and the guide
is explicit that it does so in an iframe.

That is the whole difficulty. The page in that window is served by DSM from
`/webman/3rdparty/PanelShelf`, so it always loads; the library it needs to show
is on port 8251, which is a different origin, and two separate things can stop
a browser drawing it there.

**A DSM opened over HTTPS cannot frame plain HTTP.** No setting on either side
changes it, and PanelShelf terminates no TLS by design. So the window reads the
scheme first and, on `https`, does not attempt what cannot work — it offers the
tab straight away instead of eight seconds of empty rectangle.

**The server refuses to be framed.** `X-Frame-Options: SAMEORIGIN` since the
first release, and the right default for something with no accounts: whatever
reaches the port can read the library, so a page that can frame it can lie over
the top and take a click from somebody who already has it open. The exception is
now nameable — `PANELSHELF_FRAME_ANCESTORS` — and the package names DSM's own
ports and nothing else, before `panelshelf.env` is read so that a DSM on a
custom port, or an owner who would rather not be framed, still has the last word.

Values are parsed before they reach a header, all or nothing. A header takes
what it is given; `http://nas:5000\r\nX-Frame-Options: ALLOWALL` in that
setting would otherwise write a header of somebody else's choosing onto every
response. A rejected value falls back to refusing frames and says which token it
could not read. And when a value is accepted `X-Frame-Options` is dropped rather
than sent alongside, because the two cannot be made to agree: `SAMEORIGIN`
cannot name a second origin, so a browser honouring it would block exactly the
frame the newer header was added to allow.

A refused frame is invisible from outside — nothing is readable across the
origin, and `onload` fires for the browser's error page too — so the library
announces itself with a `postMessage` on load, the window listens for that from
that origin alone, and silence is a no. Every path that is not the frame ends at
the same button the icon used to be, which puts a ceiling on what this change
can cost: one click.

Fifteen tests, each checked against the regression it describes. What none of
them cover is DSM itself drawing the window, which needs an install to see.

### A chronology dated 1800 to 2048, with a Marvel cover

Two reports from the browser on 2026-09-08, and they turned out to be three
findings.

**The years.** A DC collection was headed `1800-2048`. Fourteen files in 24,865
carried a year outside the era, and every one of them was a scan resolution:
`(Digital First - 1800px)`, `(4 covers - 2048px)`, `(1920 HR)`, and one bare
`(1920)` sitting beside a bare `(2009)`. All fourteen also carried their real
year a couple of parentheses earlier, so the filename parser had the right
answer available and took the wrong one — it accepted anything from 1800 to
2199, which is a range with no argument behind it.

Narrowing it to 1930 through next year fixes all fourteen. Measured across the
whole library: 13 filenames change, every change is a correction to the year
already in the filename, nothing else moves, and accuracy against the 7,309
comics with a `ComicInfo.xml` year is unchanged at 93.74%. No comic in the
library loses its only candidate to the new floor. The raw spread went from
`1800-2048` to `1938-2026`.

**The trim that hid it.** `yearRange` already ignored the outer tenth of a
branch's comics at each end, added to stop exactly this. It worked, and it cost
too much: on this library it reported the DC collection as `1988-2015` — the
Golden, Silver and Bronze Ages discarded to hide two bad files. Replaced with
the same validity filter. A branch is now as wide as it is.

The browser had a third copy of the rule, accepting 1800 to 2199, and it is the
one the screenshot came from: the web client builds its own chronology tree and
never used the server's trimmed answer at all. Tightened to match, which also
means an index written by an older build stops showing those years without
waiting for a rescan.

**The Marvel cover.** A DC chronology whose folders are numbered 01 to 06 was
using an *Indestructible Hulk* cover. The file is real and misfiled — a Marvel
book downloaded into the root of the DC folder — but it should not have been
able to do that. A node's own loose comics were concatenated ahead of its
children unconditionally, so a file claiming no position took position one in a
24,649-comic timeline, and with it the branch cover.

That rule is right where nothing is ranked: a series folder's own issues should
come before its Annuals subfolder. It is wrong against ranked children, and it
disagreed with `compareChronologyNodes`, which has always put unranked folders
behind ranked ones. Now they agree. Rebuilt against the real listing, the cover
is Action Comics #2 (1938) and the stray file sits at 14,122 of 24,839.

Also found, and not a bug: a second source is configured at
`/volumeUSB2/usbshare2-2/Marvel/01 Before Recorded History`, 26 comics, which is
what put a Galactus cover on the other root position.

### What a restart actually keeps

Unplanned, and worth more for being unplanned. On 2026-09-06 the package was
stopped and started twice in sixteen seconds while the library was being read
from a laptop. The log records exactly what it should: `SIGTERM`, a clean start,
and discovery rebinding on the second attempt as cleanly as on the first —
`bound` and `membership` both true, the port free by the time it was asked for
again.

What came back matters more than that it came back. The shelf was intact at
24,839 comics, the last scan's cost was still on the record, and all 28
unreadable files were still attributed to their source and still counted by
code — 15 damaged archives and 13 read errors, the same numbers as before the
stop. That is the design decision in `source-health.js` being tested rather than
asserted: the verdict lives on the comic's own record, not in the scan report
that every scan empties, so a restart does not quietly turn a damaged source
into a healthy one.

Two things still untried on this axis: a reboot, which also exercises DSM
starting the package rather than an operator doing it, and an uninstall.

### Release gates

- The cover cache does not exceed its configured ceiling, and a cover it gives
  up is rebuilt on the next request rather than reported as missing.
- Cover generation holds no more full-size pages in memory than its limit
  allows, however many cards a shelf draws at once.
- A scan of 25,000 comics completes without the server becoming unresponsive to
  reading requests.
- The log cannot grow without bound, and rotating it does not cost the lines a
  crash was about to write.
- A scheduled scan runs once at its hour, catches up a missed hour the same day,
  never runs twice in a day, and never runs while a scan started by hand is.
- An index migration that fails leaves the previous index intact and readable,
  and a copy of everything a scan cannot rebuild sits beside it.
- An index written by a newer build is never rewritten by an older one.
- A disconnected source is reported as disconnected rather than as an empty
  library, on every surface that lists it, and keeps its shelf while it is away.
- A file that will not open is still reported as unreadable on the next scan,
  and stops being reported the moment it opens.
- A client that draws its own hierarchy can ask for a listing without the
  metadata blocks it does not draw, and a client that asks for nothing in
  particular is still served the whole record.

## 11. 0.9 — Distribution candidate

### Scope

- Validate DSM 7.2 and 7.3 install, upgrade, stop/start, reboot, and uninstall.
  **Partly done on DSM 7.2**: 0.5.1 installed over 0.5.0 on the DS1825+ and the
  index migrated behind a checkpoint. The package has run since without a
  restart, which is rather the point — a deliberate stop/start, a reboot, an
  uninstall, and DSM 7.3 are all still untried.
- Validate x86-64 on the DS1825+ and representative Intel/AMD models. **The
  DS1825+ half is done**, in section 10: a full scan, a quick scan, the read
  path under scan load, an unattended scheduled run, and the cover cache
  reaching its ceiling were all measured on it. Other Intel and AMD models are
  untried.
- Build and physically test ARMv8 before advertising support for those models.
- Keep ARMv7 experimental unless a maintainable runtime passes hardware tests.
- Migration, backup/restore, rollback, and recovery testing.
- ~~Supported-model matrix, documentation, privacy policy, support contact, and
  a security-reporting process.~~ **Done.** `SECURITY.md` carries private
  reporting and a support expectation, `PRIVACY.md` states what leaves the
  machine and when, and `SUPPORTED_MODELS.md` separates the architectures that
  are built from the one that has been run — which also corrected the README,
  where publishing an ARM package had been written up as supporting ARM models.
- ~~Decide between the Synology marketplace, direct signed SPK distribution, or
  both.~~ **Decided: direct, from this repository's releases.** The marketplace
  stays possible and stops being a dependency. Approval is somebody else's
  decision on somebody else's timetable, and 1.0 cannot be gated on it; the CI
  already builds all three architectures with checksums on every tag; and the
  repository is public and MIT, so a listing would add a gatekeeper without
  adding a capability. If approval ever comes, the same SPK is what gets
  submitted, so nothing here is wasted.
- ~~Package signing.~~ **Replaced with something that works.** DSM offers no way
  to trust a particular third-party publisher — "allow any publisher" is the
  whole of the lever — so a Synology-style signature would prove nothing to the
  person installing this. The release workflow now attests each SPK instead,
  tying it to this repository, workflow and commit in a public transparency log,
  which `gh attestation verify` checks. Documented in `SUPPORTED_MODELS.md`
  beside the checksum.
- ~~Finalize the server's license before public distribution.~~ **MIT, and it is
  now shown at install.** The third-party licences already shipped inside the
  payload, which is right for attribution and wrong for terms — nobody reads a
  file they have to install the package to find. `LICENSE` is now in the SPK's
  outer archive, where DSM shows it on the install screen, and the validator
  fails the build if it goes missing or drifts from the repository's copy.
- ~~EULA.~~ **Not writing one.** MIT is the licence and the terms. A separate
  agreement would either restate MIT, which is noise, or contradict it, which is
  worse. The thing an EULA is actually for — terms visible where somebody agrees
  to them — is the install screen above.

### Release gates

- No package process runs as root. **Met, checkable, and now checked**:
  `conf/privilege` declares `run-as: package`, the SPK validator refuses to
  build a package that does not, and the support bundle reports the uid the
  server is actually running as. Asked of the DS1825+ on 2026-09-06, the running
  install answered uid 146526, group 146526, user `PanelShelf`, `root: false` —
  so this gate is now met by an installation rather than by a file in this
  repository saying it should be.
- Fresh-install and upgrade tests pass from the previous public beta.
- No unresolved critical or high-severity production dependency vulnerability.
  **Met as of 0.5.1**: one production dependency, `node-unrar-js` 2.0.2, and
  `npm audit` reports nothing.
- A nontechnical tester can install PanelShelf, authorize a USB share, add a
  source, scan, resolve an issue, and begin reading without developer help.

## 12. 1.0 — Public release

- Stable signed SPK distribution and a supported upgrade path.
- Direct distribution from the releases page, with attested builds.
- A marketplace listing if it is ever worth the review, never as a dependency.
- Public documentation, changelog, privacy policy, and security channel.
- Tested backup, restore, recovery, and uninstall behaviour.
- Published compatibility matrix and clear support boundaries.
- At least one full beta-to-release upgrade cycle tested on real hardware.
- The iPad app shipping against a released server, not a development build.

---

## Scanning test matrix

Any build that touches scanning, structure, or ordering must test at least these
layouts:

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

## Completed release history

| Version / build | Delivered outcome |
| --- | --- |
| 0.1 preview | Native DSM package, USB and internal sources, scanning, covers, search, browser reader |
| 0.2 / 1007 | Versioned source records, organization profiles, hierarchy detection, validation, disconnected-source retention |
| 0.3 / 1008 | Reading progress, reader modes, contextual Next Comic, manual reading orders |
| 0.3.1 / 1009 | All Comics, Publisher, and Chronological library views |
| 0.3.2 / 1010 | Chronology position chips, skipped branches, skipped filter |
| 0.3.3 / 1011 | Cover-first collection cards and desktop hover previews |
| 0.3.4 / 1012 | Unfiled shelf and per-comic status controls |
| 0.3.5 / 1013 | Embedded `ComicInfo.xml` extraction and display |
| 0.3.6 / 1014 | Quick, per-source, issue-retry, and full-rebuild scan actions |
| 0.3.7 / 1016 | Optional Metron matching with explicit review and provider caching |
| 0.3.8 / 1017 | Smart matching using GCD, optional Metron, and Open Library |
| 0.3.9 / 1018 | Read-only OPDS 1.2 catalogs, range requests, and acquisition |
| 0.4.0 / 1019 | Portable backup and restore; human sequence numbers in chronology chips |
| 0.4.1 / 1021 | Durable metadata editor and mislabeled-archive signature detection |
| 0.4.2 / 1022 | Timeline visualization and filename-year inference |
| 0.4.3 / 1023 | Stable shelf rendering, branch actions, bulk metadata matching |
| 0.4.3 / 1024 | Stable bulk-progress dialog hotfix |
| 0.4.4 / 1025 | Server-side reading progress and mDNS service discovery |
| 0.4.5 / 1026 | Discovery status endpoint |
| 0.4.6 / 1027 | Unsolicited discovery announcements |
| 0.4.7 / 1028 | Removing a source clears its comics from the index |
| 0.4.8 / 1029 | The same fix applied to already-indexed comics |
| 0.4.9 / 1030 | Compact library listing and per-comic detail route |
| 0.4.10 / 1031 | Grid-sized cover thumbnails |
| 0.4.11 / 1032 | Windowed shelf rendering and stable collection previews |
| 0.4.12 / 1033 | Arrival dates with `sort=added`, and progress deletions that reconcile |
| 0.4.13 / 1034 | Server-owned skipped collections, the chronology route, and imprint parents |
| 0.4.14 / 1035 | A request for a comic outside the index no longer stops the server |
| 0.4.14 / 1036 | A page turn stopped repainting every cover the shelf had drawn |

## Cross-cutting quality rules

Every release must preserve these invariants:

- Source directories and archives are opened read-only.
- A temporarily disconnected source does not disappear from configuration.
- Scanner and metadata failures do not remove an otherwise readable comic.
- Manual metadata and reading-order decisions survive rebuilds and upgrades.
- Provider credentials are masked, permission-restricted, and excluded from
  portable backups.
- Online-provider outages never prevent local scanning or reading.
- The same persisted scan record drives the toast, the Issues badge, and the
  issue panel.
- A client must never present a partial library as a complete one. Lenient
  decoding needs a visible count of what it dropped.
- Release artifacts stay reproducible and never include source archives, build
  caches, or developer files.

## Deferred and explicit non-goals

- Modifying, renaming, or reorganizing source comics automatically
- Inventing a global chronology from arbitrary unnumbered folders
- Treating an online metadata provider as a reading-order authority
- Permanent dependence on a single metadata provider
- Komga API compatibility or third-party-client impersonation
- Advertising untested Synology architectures as supported
- Internet exposure before authentication and secure deployment guidance exist
- An Android or macOS client before the iPad app has shipped once
- Server-side user accounts, logins, or per-user shelves — one library, one
  household, with reader profiles handled by the client (section 8)
