# PanelShelf

PanelShelf is a lightweight comic library and browser reader packaged natively
for Synology DSM 7.2 or newer. It scans CBZ and CBR files in one or more
folders, extracts covers, and serves comic pages without modifying the original
archives.

## Repository layout

```
server/     Node.js server, browser reader UI, and tests
synology/   DSM package metadata, scripts, and UI descriptor
scripts/    SPK and source-archive build scripts
ios/        Native iOS client (placeholder, not started — see ios/README.md)
.github/    Nightly and tagged-release build workflows
```

## Downloads

Built packages are published as GitHub releases:

- **Nightly** — the rolling [`nightly`](../../releases/tag/nightly) prerelease,
  rebuilt from `main` daily and on every push, with SPKs for `x86_64`, `armv8`,
  and `armv7` plus a source archive and `.sha256` files.
- **Versioned** — pushing a `v*` tag (for example `v0.4.4-1025`) builds and
  publishes a full release from `RELEASE_NOTES.md`.

Packages are unsigned; install through **Package Center → Manual Install** and
allow packages from any publisher.

## Version 0.4 preview features

- Native DSM package with start, stop, status, desktop shortcut, and firewall
  port registration
- Recursive CBZ and CBR scanning
- Multiple internal and USB source folders
- Per-source organization profiles: Loose comics, Folders as series,
  Hierarchical timeline, Exact reading order, and an explicit Unordered
  fallback
- Read-only source analysis with automatic layout detection, publisher
  recognition, validation, and a folder-role preview
- Numeric timeline positions including mixed-width and dotted values such as
  `09`, `010`, `029.1`, and `36.001`
- Automatic migration from the 0.1 `libraryPaths` configuration
- Last-known comics retained when a removable source is disconnected
- Server-side folder browser for mounted `/volume*` and `/volumeUSB*` paths
- Read-only `ComicInfo.xml` metadata from CBZ and CBR archives, including
  title, series, issue, volume, year, publisher, creators, genres, and summary
- Optional, manual smart matching across GCD, Metron, and Open Library, with
  candidate scoring, review, confirmed-match caching, and no background lookup
- Confirmed online metadata fills missing fields while embedded
  `ComicInfo.xml` remains authoritative; an **M** badge identifies a match
- Quick, single-source, retry-issues, and full-rebuild scan actions
- Searchable cover grid
- Main-library views for All comics, recognized Publishers, and safe
  Chronological hierarchy browsing
- Grid and focused Timeline visualizations for chronological branches, with a
  numbered rail, cover carousel, contained-comic strip, keyboard navigation,
  and a prominent current publication year
- Fallback publication-year inference from parenthetical filename tags such as
  `(2014)` and `(2006 MinuteMan)`, superseded automatically by richer metadata
- Publisher grouping recognizes both publisher folders and a publisher selected
  directly as the source root
- Chronology cards show larger, simple sibling sequence numbers such as
  `1`, `2`, and `3`, independent of zero-padded or dotted folder prefixes
- Chronology folders can be marked Skipped, visually muted, and hidden with a
  browser-local filter
- Chronological browsing exposes `_` staging folders on a dedicated Unfiled
  shelf without assigning them invented chronology positions
- Every comic card has a shelf-status menu for Unread, In progress, Completed,
  and Skipped
- Continue Reading plus unread, in-progress, completed, and skipped states
  saved in the current browser
- Automatic folder/series reading contexts and user-created manual
  chronologies
- Reading-order detail views with cover, description, item count, and progress
- Drag-and-drop manual chronology editor with multi-select and an Unplaced area
  for comics discovered by later scans
- Stable comic identity across unambiguous file moves within one source
- Context-aware Next Comic navigation skips books marked Skipped; folder and
  series contexts stop at their boundary, while exact and manual orders may
  cross folders
- Full-screen browser reader with keyboard and touch-friendly navigation
- Single-page, double-page, manga/right-to-left, and continuous-scroll modes
- Fit-width and fit-height reading modes
- Read-only archive access
- Read-only OPDS 1.2 catalogs for compatible reader apps, including All
  comics, Publishers, Sources and folders, search, and Reading orders
- Portable backup and restore for source settings, manual reading orders,
  confirmed metadata matches, server-side reading progress, and browser-local
  chronology/reader preferences
- Persistent configuration and library index

## Install on the DS1825+

1. Open **DSM → Package Center → Manual Install**.
2. Select `PanelShelf-x86_64-0.4.3-1024.spk`.
3. Accept the warning for a third-party package.
4. Start PanelShelf and click **Open**, or visit:
   `http://YOUR-NAS-IP:8251/`
5. Open **Library settings**, browse to a comics folder, review the detected
   structure, then choose **Save and scan**.
6. Use **All comics**, **Publishers**, or **Chronological** on the main shelf.
   Open **Reading orders** when you want to build a custom sequence that spans
   folders and series.

## Supported source conventions

PanelShelf asks you to confirm one convention for each source:

- **Loose comics:** CBZ/CBR files live directly in the selected folder.
- **Folders as series:** each first-level folder is a series, with one optional
  volume or arc level.
- **Hierarchical timeline:** numbered sibling folders are ordered within their
  own branch; unnumbered folders remain groups and `_` folders are unfiled.
- **Exact reading order:** every participating file or branch has a unique
  numeric position.
- **Unordered library:** recursive indexing without claiming a chronology.

The structure preview labels publisher containers, ordered sections, groups,
series, unfiled folders, and ignored empty folders. It never writes to, moves,
or renames source content.

## Embedded metadata

When an archive contains `ComicInfo.xml`, PanelShelf reads it without changing
the CBZ or CBR. Embedded title, series, issue, volume, date, publisher, imprint,
creator, genre, tag, story-arc, language, rating, and summary fields are stored
in PanelShelf's private index. An **XML** badge identifies comics with embedded
metadata.

Embedded series and issue numbers improve series display and local issue
ordering, but they never create a cross-folder chronology. Numbered folders,
Exact reading-order positions, and manual reading orders remain authoritative.
A malformed `ComicInfo.xml` appears as a warning while the comic and its image
pages remain available.

After upgrading from a build before 1014, run one **Full rebuild** to read
metadata from comics that were already indexed.

## Optional online metadata

PanelShelf 0.4.3 can search one comic at a time with this fallback order:

1. **Grand Comics Database (GCD):** primary comics and collected-edition
   matching, with no key required.
2. **Metron:** optional second source when the NAS owner supplies a personal
   token.
3. **Open Library:** no-key fallback for trade paperbacks, hardcovers,
   omnibuses, and graphic novels.

The search dialog keeps series and title/subtitle separate and scores candidates
from series, issue or volume, subtitle, year, publisher, and edition. Smart
fallback stops when a provider returns a strong match; the user can also choose
one provider explicitly. Filenames such as
`Avengers Arena v01 - Kill Or Die (2013)` prefill the trade format, volume,
subtitle, and year for review.

PanelShelf never contacts a provider during a library scan and never uploads an
archive or page image. Individual searches remain review-first. The separate
**Enrich metadata** job checks only unmatched comics and automatically attaches
a result only when it scores at least 90% and leads the runner-up by at least 10
points. Existing confirmed matches are never replaced; ambiguous results remain
available for manual review.
Embedded `ComicInfo.xml` values always win, and online story arcs never affect
folder chronology.

Metron tokens are stored in permission-restricted package data and returned to
the browser only as masked hints. Verify every provider's current terms before
shipping a paid release.

Search and record results are cached to reduce requests. If a provider is
unavailable, local scans and reading continue normally and cached confirmed
matches remain usable. GCD and Open Library cover images are not redistributed;
PanelShelf keeps using the archive's local cover.

## OPDS reader access

Compatible reader apps can connect to:

`http://YOUR-NAS-IP:8251/opds`

The OPDS 1.2 catalog provides All comics, Publishers, Sources and folders,
automatic and manual Reading orders, search, local cover images, and direct
CBZ/CBR acquisition with byte-range support. Reading-order feeds preserve the
order stored by PanelShelf.

OPDS access is read-only. Reader-app progress is not synchronized back to
PanelShelf, because generic OPDS 1.2 does not define a universal progress
protocol. This preview is intended for a trusted LAN and does not yet protect
the OPDS catalog with user authentication.

## Reading progress API

Reading progress lives on the server, so every browser — and a future iPad
app — shares one reading position per comic.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/progress` | Every record for comics currently in the library |
| GET | `/api/progress/:comicId` | One record, or `404 NOT_FOUND` if none is stored |
| PUT | `/api/progress/:comicId` | Save one record; the server stamps `lastReadAt` |
| DELETE | `/api/progress/:comicId` | Mark a comic unread; idempotent |
| POST | `/api/progress/batch` | Save and delete many records in one request |
| POST | `/api/progress/merge` | Reconcile client records against stored ones, newest wins |

`:comicId` is a 24-character lowercase hex id; any other shape falls through to
the generic `404`.

A record is:

```json
{
  "pageIndex": 12,
  "pageCount": 30,
  "completed": false,
  "skipped": false,
  "lastReadAt": "2026-08-12T18:04:11.902Z",
  "orderId": "manual-chronology-id"
}
```

`pageIndex` and `pageCount` are coerced to whole numbers (anything negative or
unparseable becomes `0`), `completed` and `skipped` to booleans, and
`lastReadAt` and `orderId` to trimmed strings or `null`. Unknown fields are
dropped. A client-supplied `lastReadAt` is ignored on `PUT` and on
`/batch`: the server clock is authoritative there, so a device with a skewed
clock cannot lose its own write.

`GET /api/progress` returns an object keyed by comic id. Records for comics
that are not currently in the library — for example a disconnected USB
source — are retained in the store but omitted from this response.

**The three endpoints deliberately disagree about unknown ids.** Only the list
filters against the current library. `PUT /api/progress/<well-formed id not in
the library>` returns `200` and stores the record, `GET
/api/progress/<same id>` returns it, and `GET /api/progress` omits it. This is
what lets a disconnected USB source keep its reading positions: unplug the
drive and the positions survive; plug it back in and they reappear in the list
untouched. `PUT` therefore does **not** 404 for an id the library does not
currently know, and should not be changed to — the drive being unplugged is
precisely when the write has to succeed. A client that reconciles its local
state against `GET /api/progress` alone will see records it just wrote go
missing; treat that list as "progress for comics you can open right now", not
as the full contents of the store.

**Choose the right write.** `PUT` and `POST /api/progress/batch` are deliberate
writes: the record supplied is applied unconditionally. `POST
/api/progress/merge` is reconciliation, not a user action — the server compares
each incoming `lastReadAt` against the stored one and keeps the newer, so a
deliberate change sent through `merge` can be silently discarded. Use `merge`
only for the one-time import of browser-local progress and for flushing writes
a client queued while offline; use `PUT` or `/batch` for everything a person
just did.

`POST /api/progress/batch` takes both saves and deletions and applies them in a
single write, which is what a "mark this whole collection read" action should
send:

```json
{
  "records": { "0f2a…": { "pageIndex": 29, "pageCount": 30, "completed": true } },
  "deleted": ["9c81…"]
}
```

Both keys are optional. The whole batch is validated before anything is
applied: a malformed comic id or record fails the request with `400
INVALID_PROGRESS` and changes nothing.

`POST /api/progress/merge` accepts either `{ "records": { … } }` or a bare map
of records. Unusable records are skipped rather than failing the request. Per
comic id the newer `lastReadAt` wins; a record with no usable timestamp loses to
one that has it, and the incoming record wins ties.

`POST /api/progress/batch`, `POST /api/progress/merge`, and `GET
/api/progress` all answer with the same shape as `GET /api/progress`: the full
current map for comics in the library. `PUT` answers with the single saved
record, and `DELETE` with `{ "deleted": true, "id": "…" }` whether or not a
record existed. Request bodies are capped at 256KB for `PUT` and 20MB for the
two bulk routes.

Backups continue to carry progress. `POST /api/backup/export` always reads it
from the server store, ignoring any progress the caller sends, and restoring a
backup replaces the server store.

## Service discovery

At startup the server advertises itself on the local network over mDNS as
`_panelshelf._tcp`, answering PTR queries for that service type with SRV, TXT,
and A records. The TXT record carries `version`, `port`, and
`path=/api/health`.

Discovery is strictly optional and best-effort. If the socket cannot bind, join
the multicast group, or send, the server logs nothing special and continues
serving HTTP normally; entering the NAS address by hand always works. Whether a
given client sees the advertisement depends on its own network — some Wi-Fi
networks and VPNs block multicast between hosts. To check from macOS on the
same LAN:

```bash
dns-sd -B _panelshelf._tcp
```

## Backup and restore

Open **Library settings** and select **Export backup** to download a portable
PanelShelf JSON file. A backup contains:

- source paths and organization profiles
- manual reading orders
- confirmed online metadata matches
- reading progress and unread/in-progress/completed/skipped states, taken from
  the server rather than from the browser creating the backup
- selected library view and skipped chronology folders from that browser
- reader fit and page mode

Comic archives, generated covers, scan indexes, logs, and metadata-provider
credentials are excluded. They are either source content, regenerable, or
sensitive. Choose **Restore backup** to validate and preview counts before
replacing current settings. Unavailable USB sources remain configured, and a
quick scan begins after restoration.

## Scan actions

The main button performs a **Quick scan**. Its adjacent menu provides:

- **Quick scan:** walks every source but reopens only new or changed archives.
- **Scan one source:** quick-scans one selected internal or USB source while
  preserving every other source.
- **Retry issues:** rechecks only files or sources reported by the latest scan.
- **Full rebuild:** reopens every archive and rereads pages and embedded
  metadata.

All four actions are read-only. A disconnected source retains its last-known
comics, and one-source scans never remove comics from another source.

## Reading progress and Next Comic

Reading progress is stored on the server, so the page and the active reading
order follow you between browsers, browser profiles, and computers. A browser
holding progress from an earlier build imports it into the server once, on
first load. Each browser also keeps a local copy, so reading continues if the
server goes away mid-session and nothing is lost from the page you are on.
Saving is best-effort rather than offline-capable: a save that fails is not
retried on its own. The position converges on the next successful save, or on
the next load, which keeps whichever copy has the newer timestamp. Progress is
shared by everyone using the server; there are no separate per-user shelves
yet.

Use the `•••` menu on a comic card to set its shelf status directly. Choosing
**Unread** clears that comic's saved progress, **In progress** returns it to
Continue Reading, **Completed** marks its final page, and **Skipped** removes it
from Continue Reading and makes Next Comic pass over it. These status changes
do not modify the comic archive.

Next Comic follows the context used to open the reader:

- A series or ordinary folder advances only through comics in that same safe
  context.
- An Exact reading order or manual chronology can continue across folders
  because that sequence was explicitly defined.
- A hierarchical timeline stops at an unnumbered branch boundary instead of
  guessing which unrelated branch comes next.

Newly scanned comics from a source used by a manual chronology appear in its
**Unplaced** area. PanelShelf never inserts them into an existing sequence
without confirmation.

## USB folders and DSM permissions

USB shares are commonly mounted at paths such as:

```text
/volumeUSB1/usbshare/Comics
```

PanelShelf runs as the restricted `PanelShelf` package account. The selected
folder must be readable and searchable by that account. If PanelShelf reports a
permission error:

1. Open **Control Panel → Shared Folder**.
2. Select the internal or USB shared folder.
3. Open **Edit → Permissions**.
4. Show **System internal users** if DSM provides that selector.
5. Give the PanelShelf package account **Read only** access.
6. Return to PanelShelf and save or scan again.

DSM versions can label package accounts differently. Never grant write access;
PanelShelf does not need it.

If a configured USB drive is disconnected, its source stays in PanelShelf and
is shown as unavailable. Reconnect it at the same mount path and rescan.

## Security scope

This preview is intended for a trusted home LAN. It does not yet provide user
accounts or its own TLS termination. Do not forward port 8251 directly to the
internet. If remote access is needed, place it behind a properly authenticated
HTTPS reverse proxy or VPN.

The folder browser exposes only mounted Synology volume paths. PanelShelf never
offers browsing of DSM system directories.

## Local development

Requirements:

- Node.js 18 or newer
- npm

```bash
npm run install:server
PANELSHELF_DATA=/tmp/panelshelf-data npm start
```

Open `http://localhost:8251/`.

## Build the x86-64 SPK

The build downloads a pinned Node.js runtime, installs production dependencies,
creates DSM icons, assembles `package.tgz`, and writes the final SPK to `dist/`.

```bash
npm run build:spk
```

Set `PANELSHELF_NODE_BINARY` to use an already available compatible Node.js
binary.

To produce Plex-style cross-build candidates for the common Synology families:

```bash
npm run build:all
```

This creates separate `x86_64`, `armv8`, and `armv7` SPKs from the same source.
Only the `x86_64` package is supported by this first preview. ARM candidates
must be tested on representative Synology hardware before distribution; older
ARMv7 models in particular may have kernel/runtime constraints.

## Data locations on DSM

- Application: `/var/packages/PanelShelf/target`
- Configuration and index: `/var/packages/PanelShelf/var`
- Log: `/var/packages/PanelShelf/var/panelshelf.log`
- Port: `8251/tcp`

Uninstalling the package may remove its private configuration and index. It
never removes comics from selected source folders.
