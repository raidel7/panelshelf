# PanelShelf Roadmap

Updated: 2026-08-29

| Component | Version | State |
| --- | --- | --- |
| **Server and web** | 0.4.15, build 1037 | Released. The developer's NAS runs 0.4.14. |
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

Nothing is unreleased on `main`. The 0.4.14 heading covers 1035 and 1036 as
point fixes; the storyline and library-editing scope filed under 0.4.17 in
section 7 has not been started.

### Companion iPad app

A native iPad client is developed separately, in its own repository, and is not
part of this project's source. It speaks to this server over the documented
HTTP API and the OPDS catalog, and shares reading position through
`/api/progress/merge` — which is why that endpoint's contract is treated here
as public surface rather than an internal detail. Its own roadmap is tracked
alongside the app.

### Known gaps in the foundation

- No user accounts, OPDS authentication, or device tokens.
- Thumbnails are generated on first request, on NAS CPU, and there is no way to
  warm them deliberately or to see what the cache costs.
- The web viewer still downloads the full library listing, because it needs
  fields the compact record drops.
- No marketplace-ready support workflow.

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

Server milestones continue from 0.4.15. The numbers 0.4.4 through 0.4.15 are
spent; anything planned takes 0.4.16 or later. Section numbers are stable
identifiers and are referenced elsewhere in this document, so the gaps below
are deliberate — those milestones belong to the iPad client and moved with it.

| # | Milestone | Status | Planning range |
| --- | --- | --- | --- |
| 5 | 0.4.15 — Offline shelf and cover cache | **Done** — 0.4.15 | — |
| 6 | 0.4.16 — Sync API hardening | Planned | 2–3 weeks |
| 7 | 0.4.17 — Storylines and advanced library editing | Planned | 3–5 weeks |
| 8 | 0.5 — Accounts and secure client access | Planned | 3–4 weeks |
| 10 | 0.7 — Reliability, performance, administration | Planned | 3–5 weeks |
| 11 | 0.9 — Synology marketplace candidate | Planned | 3–6 weeks plus review |
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

Shipped so far, unreleased on `main`: device tokens with pairing by short code,
enforcement across `/api` and OPDS, the pairing panel in Library settings, an
additive `/api/v1` prefix, `GET /api/changes`, the write contract documented,
and `npm run conformance`. Outstanding: stable identifiers and the explicit
unavailable-source and offline-cache states, both of which look largely done and
need verifying rather than building.

### Goal

Turn the endpoints the app grew into a stable, versioned, authenticated
contract, while OPDS stays a separate read-only catalog standard.

### Scope

- Version the JSON API for library views, comics, folders, chronology, pages,
  and reading orders.
- Device-token creation, revocation, expiry, and last-used reporting, so pairing
  never means pasting a long-lived password.
- An incremental library-change endpoint, so a client does not re-download the
  whole catalog to learn that one comic moved.
- Conflict-safe progress writes: keep the existing split where `PUT` and
  `/batch` are deliberate server-stamped writes and `/merge` is reconciliation,
  and document it, because a user action sent through `/merge` can be discarded
  with a 200.
- Stable comic and reading-order identifiers across safe rescans and moves.
- Explicit unavailable-source and offline-cache states for clients.
- API documentation and a small conformance suite.

### Non-goals

- No Komga API emulation, no third-party client impersonation.
- No write-back into CBZ or CBR archives.

### Release gates

- Progress written by one authorized client appears consistently in the other.
- A stale client write cannot silently replace newer progress.
- Revoked credentials lose access immediately.
- A rescan does not break client bookmarks for unchanged comics.

## 7. 0.4.17 — Storylines and advanced library editing — server and web

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

## 8. 0.5 — Accounts and secure client access — server

### Scope

- First-launch administrator setup.
- Multiple users with separate progress, statuses, lists, and preferences.
- Secure sessions, password reset, rate limiting, and device management.
- Authentication for OPDS and every non-public endpoint.
- Migration of existing guest state into a chosen account.
- Responsive tablet and phone improvements on the web.
- Trusted reverse-proxy and HTTPS documentation.
- An exportable support bundle with sanitized configuration, versions, and logs
  — never credentials or comic contents.

### Release gates

- With accounts enabled, no library, page, acquisition, or progress endpoint is
  anonymously accessible.
- Separate users never receive each other's reading state.
- Backup and restore preserve accounts without exporting reusable secrets.

## 10. 0.7 — Reliability, performance, and administration — server

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

## 11. 0.9 — Synology marketplace candidate

### Scope

- Validate DSM 7.2 and 7.3 install, upgrade, stop/start, reboot, and uninstall.
- Validate x86-64 on the DS1825+ and representative Intel/AMD models.
- Build and physically test ARMv8 before advertising support for those models.
- Keep ARMv7 experimental unless a maintainable runtime passes hardware tests.
- Package signing, migration, backup/restore, rollback, and recovery testing.
- Supported-model matrix, documentation, privacy policy, EULA, support contact,
  and a security-reporting process.
- Decide between the Synology marketplace, direct signed SPK distribution, or
  both.
- Finalize the server's license before public
  distribution.

### Release gates

- No package process runs as root.
- Fresh-install and upgrade tests pass from the previous public beta.
- No unresolved critical or high-severity production dependency vulnerability.
- A nontechnical tester can install PanelShelf, authorize a USB share, add a
  source, scan, resolve an issue, and begin reading without developer help.

## 12. 1.0 — Public release

- Stable signed SPK distribution and a supported upgrade path.
- Marketplace listing where practical, direct distribution as a fallback.
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
