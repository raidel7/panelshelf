# PanelShelf 0.4.14-1035

A crash fix. Install this one.

## One bad request could stop the server

- Asking for the file of a comic that is not in the index — a stale link, a
  bookmark to a comic removed by a scan, a client retrying after a rescan —
  stopped PanelShelf completely. Not that one request: the whole server, for
  everybody, until it was started again from Package Center.
- The route reported "comic not found" by raising an error, and the way it was
  written that error escaped the request handler instead of becoming a 404.
  Node ends the process when nothing handles an error like that.
- It now answers 404 and carries on serving.
- This has been present since OPDS shipped in 0.3.9, on
  `/opds/comics/<id>/file`. It was found by asking for a comic id that does not
  exist, which is exactly what a stale reader app does.

## Downloading a comic has a first-party address

- `GET /api/comics/<id>/file` serves the archive, with byte ranges and HEAD, so
  an app can download a comic to read offline and resume an interrupted
  transfer. It is the same file OPDS already served, under a path that does not
  require reaching into the catalogue namespace.

## Validation

- 181 server tests pass, including one that asks both file routes for a comic
  that does not exist and then checks the server is still answering.

# PanelShelf 0.4.13-1034

Everything the iPad app needs to browse your library the way the web viewer
does. Nothing here changes what the browser looks like, but two things move
underneath it.

## Skipped collections are shared between the browser and the app

- Collections you set aside in Chronological were remembered by the browser
  alone, so an iPad showed every branch you had hidden.
- They now live on the server with your reading progress. Skip a collection in
  either place and it is skipped in both.
- Your existing skipped collections are handed over automatically the first time
  you open the web viewer after upgrading. Nothing to do, and nothing is lost:
  backups keep carrying them, and restoring a backup puts them back.

## The library list answers three new questions

None of these change an existing response, so nothing that already works
changes behaviour.

- **The chronology, one folder at a time.** `GET /api/chronology` returns where
  you are, the way back, the collections below, and the comics filed at that
  level. The browser builds this itself from the whole library; a phone or
  tablet cannot afford to, so the server does it and keeps the result until the
  next scan. Across 24,839 comics that takes under a second, once.
- **Skipped collections.** `GET /api/skips` and `POST /api/skips`.
- **The publisher an imprint belongs to.** The compact comic list now includes
  it, so a Publishers view can file WildStorm under DC rather than beside it.
  It adds about 3% to that response and only appears where a publisher actually
  has a parent.

## Collections carry the years they cover

- A chronology folder now reports the span of the comics inside it, taken from
  their metadata.
- The outer tenth at each end is ignored once there are enough dated comics to
  be confident about it. One filename parsed as "1800" would otherwise date a
  whole era: the raw spread across this library is 1800 to 2048.
- Measured against real folders: Modern Age Chronology (1985-2011) reports
  1988-2011, and New 52 Chronology (2011-2016) reports 2012-2015.

## Validation

- 179 server tests and 116 iPad tests pass.
- The browser's handover of skipped collections was checked end to end against
  a real scan: a browser carrying a skipped branch hands it over once, and a
  browser whose branches were unskipped elsewhere does not push its old copy
  back.
- The chronology's ordering rules were checked by breaking them on purpose.
  A folder numbered 2 must come before one numbered 10 even when the numbers
  are hidden and the names say otherwise.

# PanelShelf 0.4.12-1033

Groundwork for the iPad app's Home screen, and a progress fix that shows up in
your browser.

## Marking a comic unread on the iPad no longer leaves it half-read here

- The iPad recorded "unread" by saving a position of page 1 rather than by
  clearing the saved position. The web viewer treats any saved position that is
  not completed or skipped as started, so a comic you marked unread on the iPad
  reappeared in Continue Reading at 1%.
- The iPad now clears the position, which is what the web viewer has always
  done. Marking a comic unread on either one leaves it unread on both.
- If the iPad is offline when you do it, the change waits with the rest of its
  unsent reading positions and is sent when it reconnects — and it is weighed
  against what the server holds rather than applied blindly. Marking a comic
  unread on the iPad at noon will not wipe out a position you read in the
  browser at one; the older of the two loses.

## The library list can be asked for what arrived most recently

- Comics now record when they first entered the library, and keep that date
  through rescans and through being moved to another folder.
- `GET /api/comics` accepts `sort=added` and `limit`, so a client can ask for
  the dozen most recent comics instead of downloading the catalogue to find
  them. This is what the iPad app's Home screen is built on.
- Comics already in your library keep working without a rescan: until a scan
  gives them an arrival date, the file's own date stands in.
- Comics found by the very first scan of a new source are dated by their files
  rather than by the scan. Adding a folder of ten thousand comics should not
  make all ten thousand of them "added today".

## Validation

- 154 server tests and 102 iPad tests pass.
- The reading-position rules were checked by breaking them on purpose: applying
  an offline deletion without weighing it, forgetting a queued deletion across a
  relaunch, and handing a cleared position back on the next refresh each fail
  the test written for them.

# PanelShelf 0.4.11-1032

The web viewer stops rebuilding your whole library every time anything changes.

## The shelf no longer flickers

- The viewer drew one card, with its own cover image, for every comic in the
  library — and it threw all of them away and built them again whenever
  anything changed: marking a comic read, changing a filter, switching views,
  finishing a scan, opening and closing the reader. On a 26,625-comic library
  that is 26,625 cards and about 1.1 million elements, rebuilt from scratch
  around twenty times over. That rebuild is the flicker.
- The shelf now draws what fits on screen and adds more as you scroll, and a
  re-render reuses the cards that are already there instead of replacing them.
  Measured on a 26,625-comic library: the shelf appears in 0.7 s instead of
  4.9 s, holds 4,900 elements instead of 1,145,778, and a redraw that used to
  take 1.3 s of frozen page now takes under a millisecond.
- Marking one comic read used to rewrite the badge, progress bar and menu on
  every card in the library — 106,500 changes to the page for one comic, which
  took 5.5 seconds and flashed the whole shelf. It now changes that one card:
  four changes, in about ten milliseconds.
- Scrolling the shelf was running at about three frames a second, with 91
  stalls totalling 20.7 seconds across a walk down the library. The same walk
  now runs at frame rate with no stalls.
- A finished scan, a metadata edit, or anything else that reloads the library
  used to tear out every cover on screen and ask for it again. Cards whose
  comic did not actually change are left alone, so a scan finishing behind you
  no longer blanks the shelf you are looking at, and your place in it is kept.
- Search is quicker to the same end: typing in the search box was rebuilding a
  searchable line of text for all 26,625 comics on every keystroke.

## Hovering a collection keeps its cover

- The hover preview cleared its image and showed the collection's initials
  before asking for the next cover, so moving along a shelf blanked the preview
  to two letters and back on every card. With covers arriving in about a fifth
  of a second, that is roughly 600 ms of blank per four cards.
- The cover on screen now stays until its replacement has loaded. A preview
  opening fresh still starts on the initials — there is nothing to keep — and a
  cover that stalls for more than a moment gives way to them rather than
  sitting under the wrong title.

# PanelShelf 0.4.10-1031

Cover thumbnails, so a shelf stops downloading full-size scanned pages.

## A screenful of cards no longer costs 26 MB

- A cover is the comic's first page at full scan resolution. Across a sample of
  twelve real covers from a 26,625-comic library they average 1.09 MB, and the
  grid draws them into cards about 140pt wide. Twenty-four cards moved roughly
  26 MB to paint about a megabyte's worth of pixels.
- `GET /api/comics/:comicId/cover?size=thumb` answers with the same cover
  scaled so its longest edge is at most 480 pixels. Measured against the same
  twelve covers: 13.04 MB becomes 0.49 MB, 26 times smaller. The 774 KB
  1074x1650 cover this started from comes back as 50 KB at 312x480.
- 480 is fixed, not a parameter. An iPad card is 140-180pt wide, so a Retina
  panel wants 280-360 device pixels across and a 2:3 cover 480 tall is 320
  across. A caller-chosen size would multiply the cache by every size anyone
  ever asked for, and would let one client walk a NAS CPU through a thousand
  resizes. `size` accepts only `thumb` and `full`; anything else is a 400.
- The default is unchanged. Without `size=thumb`, the endpoint returns the
  untouched original bytes with their original content type, so the reader,
  OPDS readers and any existing client are untouched.
- The iPad grid and the web viewer's shelf, collection artwork, timeline covers
  and reading-order cards all ask for thumbnails now. Anything that shows a
  cover at size — the reader, the detail hero, the metadata comparison where
  the point is to judge the artwork — still gets the full image.
- Thumbnails are generated the first time one is requested, not during a scan:
  eager generation would add an image decode and encode per comic to every
  scan, for covers most users never scroll past. They are cached beside the
  full-size covers in the data directory, about 42 KB each. The first request
  for a cover took 68-272 ms on a developer Mac; every later one is a file
  read, about 1 ms.
- Resizing needs no native image library, which would have meant per-
  architecture binaries in a package built for x86_64, armv8 and armv7. The
  server decodes baseline and progressive JPEG and PNG itself and runs the
  inverse DCT at the smallest scale that still covers the thumbnail, so a
  1074x1650 cover is reconstructed at 537x825 rather than in full. A cover
  already smaller than a card, or in a format that decoder cannot read, is
  served whole.

# PanelShelf 0.4.9-1030

A compact library listing, for clients that only draw a shelf.

## The comic list no longer sends everything to everyone

- `GET /api/comics` sends every field of every comic. On a 26,625-comic library
  that is 71.2 MB in one unpaginated array, and most of it is three metadata
  blocks that largely duplicate each other, plus the ordering path and folder
  hierarchy that no list on any screen draws.
- `GET /api/comics?view=compact` sends the seven fields a browsing list
  actually needs — id, title, series, page count, availability, format, and the
  publisher's name. Measured against the same 26,625 comics: 5.0 MB, 14 times
  smaller. The title, series and publisher are the same display values the full
  record computes, so a corrected or online-matched comic reads the same on a
  shelf as on a detail screen.
- The default is unchanged. Without `view=compact` — or with any other value —
  `/api/comics` answers exactly as it did, so the web viewer, OPDS readers and
  any existing client are untouched. `q` still filters against the full record.
- `GET /api/comics/:comicId` is new: one comic in full, without opening its
  archive. Until now the only way to get a single comic's whole record was
  `/api/comics/:comicId/pages`, which reads the file to enumerate its pages —
  seconds, on a drive that has spun down.
- The iPad app uses both: the shelf loads the compact list and caches it, and a
  comic's detail screen fetches the full record when you open it. What it shows
  while that is in flight, or if it fails, is a shorter table rather than a
  broken one.

# PanelShelf 0.4.8-1029

Upgrading is enough to clear out removed folders.

## The previous fix now reaches comics already indexed

- 0.4.7 stopped comics from a removed library folder being carried forward, but
  only once you scanned or re-saved Library folders. An index written by an
  older build still listed them until then, which for anyone who had already hit
  this bug meant installing the fix appeared to do nothing.
- The index is now checked against your library folders at startup, so the
  comics from a folder you removed are gone as soon as the package restarts.
  Reading orders and saved metadata matches are reconciled with it.
- A folder that is configured but unavailable at startup — a USB drive unplugged
  during a reboot — keeps every one of its comics. Only folders that are no
  longer in Library folders at all are cleared.
- A library with nothing to clear out is not rewritten at startup.

# PanelShelf 0.4.7-1028

Removing a library folder now actually removes its comics.

## Removed sources leave the index

- Removing a folder from Library folders left every comic it had contributed
  sitting in the index forever. Scanning did not help: each scan deliberately
  carries forward the comics belonging to sources it is not touching, and a
  source that is no longer configured belongs to nothing, so its comics were
  carried forward every time. Measured on a real NAS as one configured source
  and 26,625 indexed comics, 1,786 of them from a folder removed weeks earlier.
- A comic is now kept only while a configured source still claims it. Comics
  from a removed source are dropped on the next scan, including a retry scan.
- Removing a folder takes effect immediately. Saving Library folders prunes
  that folder's comics right away rather than leaving them visible until you
  remember to scan, and reading orders, saved metadata matches, and the page
  cache are reconciled at the same time as they are after a scan.
- Restoring a backup whose configuration names a different set of folders
  prunes the same way.
- A folder that is configured but temporarily unavailable — an unplugged USB
  drive — is unaffected. Its comics are still retained and shown as
  unavailable, exactly as before. Removed and unplugged are now different
  things.
- A manual reading order that spanned a removed folder survives. The comics
  that left are reported as missing, the same as for a disconnected drive,
  rather than vanishing from the order.

# PanelShelf 0.4.6-1027

Service discovery that actually works on a NAS.

## Announced discovery

- The server now announces itself on the local network instead of waiting to be
  asked. DSM runs its own responder, which owns the mDNS port, so queries sent
  by a browsing client were delivered to it and never to PanelShelf — measured
  on a real NAS as zero matching queries against 169 datagrams.
- Announcements go out at startup and every 90 seconds thereafter, well inside
  the 120-second record lifetime, so a client that starts browsing later still
  finds the server.
- Stopping or upgrading the package now sends a goodbye, so clients drop the
  entry immediately instead of waiting for it to expire.
- Announcements are pinned to the network interface the server advertises.
  Previously they followed the default route, which on a machine with a VPN or
  a Docker bridge meant they left on the wrong interface and nothing on the LAN
  ever saw them.
- `GET /api/discovery` additionally reports the interface in use, the announce
  interval, the time of the last announcement, and how many announcements and
  goodbyes have been sent.
- Answering direct queries still works where the mDNS port is free. It is now a
  bonus path rather than the mechanism discovery depends on.

# PanelShelf 0.4.5-1026

Diagnostics for service discovery.

## Discovery status endpoint

- `GET /api/discovery` reports what the mDNS advertisement actually did: the
  address, host, and port it advertised, whether the socket bound and joined
  the multicast group, how many datagrams and matching queries it saw, how many
  responses it sent, and the last error from each path.
- The same status is written to the package log once at startup.
- Nothing about advertising changed. This build exists to explain why a client
  browsing the network does not see the server, on a NAS where no shell is
  available.
- Reading progress, the library, and every other endpoint are unchanged from
  0.4.4.

# PanelShelf 0.4.4-1025

Server-side reading progress shared by every browser, and service discovery on
the local network.

## Server-side reading progress

- Reading progress now lives on the server, so one position per comic is shared
  by every browser, browser profile, and computer using the library.
- Progress already stored in a browser is imported into the server once, on
  first load; a second reload does not re-import it.
- Each browser keeps a local copy, so reading continues if the server goes away
  mid-session. Saving is best-effort, not offline reading: a save that fails is
  not retried on its own, and the position converges on the next successful
  save or on the next load, which keeps whichever copy is newer.
- Unread/in-progress/completed/skipped changes, including whole-branch actions,
  are sent as one deliberate write that the server timestamps and applies.
- Backup and restore are unchanged for users; a backup now takes progress from
  the server store instead of the exporting browser.
- New `/api/progress` endpoints cover reading, saving, deleting, bulk writes,
  and merging, and are documented in the README for future clients.

## Service discovery over mDNS

- The server advertises itself on the local network as `_panelshelf._tcp`,
  publishing its host, port, and version for clients that browse for it.
- Advertising is best-effort and optional: if it cannot start or the network
  blocks multicast, the server serves over HTTP exactly as before.
- Whether a client finds the server this way depends on the network; entering
  the NAS address by hand remains the supported path.
- No package or data migration is required.

# PanelShelf 0.4.3-1024

Stable browsing, branch actions, and conservative library-wide metadata
matching.

## Build 1024 display hotfix

- Fixed the entire metadata-progress dialog briefly disappearing while its
  background job was running in Chrome.
- Progress polling now updates only values that changed and reuses keyed result
  rows instead of replacing the complete results list every second.
- The bulk-progress backdrop uses a stable opaque tint without GPU backdrop
  blur, avoiding Chrome dropping and recreating the native dialog layer.
- Replaced Chrome's native progress control with a regular CSS bar so percentage
  changes remain on the dialog's existing paint layer.
- No database, matching, provider, or package-data migration is required.

## Stable web shelf and reader navigation

- Cover URLs that have already loaded remain visually warm during local UI
  updates, preventing placeholder flashes while moving through the timeline.
- Timeline focus changes redraw only the carousel instead of rebuilding the
  entire library view.
- Closing the reader updates visible progress in place and preserves the exact
  library view, chronology branch, filter, and scroll position underneath.
- The reader now has a labeled **Back** button rather than an unexplained close
  icon.

## Chronology branch actions

- Top-level chronology cards now include an ellipsis menu.
- Start the first unread comic or continue the first active comic in a branch.
- Mark every comic in a branch unread or completed in one action.
- Skip or restore a branch from the same menu; the existing one-click skip
  control remains available.
- The focused timeline position exposes the same actions.

## Library-wide metadata enrichment

- **Scan → Enrich metadata** starts a resumable background job for unmatched
  comics only.
- Smart fallback uses the enabled GCD, optional Metron BYOK, and Open Library
  providers without sending archive contents or page images.
- A candidate is approved automatically only at 90% confidence or higher and
  when it leads the runner-up by at least 10 points.
- Ambiguous matches stay unattached for manual review; existing confirmed
  matches and local/ComicInfo/manual metadata precedence are preserved.
- The job can be paused, resumed after a NAS restart, or cancelled, with live
  progress and recent-result summaries.

## Validation

- Automated coverage includes filename-to-query inference, the confidence and
  clear-winner gates, restart-safe job persistence, shipped controls, and
  browser-script parsing.

## Previous 0.4.2 foundation

Focused chronology timeline and filename publication-year fallback.

## Timeline visualization

- Chronological browsing now provides a persistent **Grid / Timeline** toggle.
- Timeline mode presents sibling folders as a numbered chronology rail and a
  focused cover carousel instead of another dense grid.
- Previous/next buttons and Left/Right, Home, and End keys move through the
  current branch without changing its stored order.
- The selected position exposes up to 16 contained comics in reading order,
  with direct reader access and an option to open the full branch.
- Skipped folders remain visibly muted and crossed out; the existing Hide
  skipped preference also applies to the timeline.
- The current position prominently displays its publication year or year range
  and identifies whether it came from a filename, ComicInfo.xml, confirmed
  online metadata, or a manual edit.
- The selected Grid/Timeline mode is browser-local and included in portable
  backup and restore.

## Filename publication years

- Quick Scan now extracts a fallback year from parenthetical filename tags
  such as `(2014)` and `(2006 MinuteMan)` without opening unchanged archives.
- Only parenthetical four-digit years are considered; ambiguous ranges such as
  `(1985-2012)` are ignored unless a later unambiguous release year is present.
- Filename years are stored separately and at the lowest metadata priority.
  ComicInfo.xml, confirmed online metadata, and manual edits replace the
  fallback automatically without changing chronology.
- Existing libraries receive the fallback years on their next Quick Scan; a
  Full Rebuild is not required.

## Validation

- 42 automated tests cover filename inference and precedence, timeline UI
  shipping, backup round trips, scanning, metadata, archive compatibility,
  OPDS, and reading orders.

## Previous 0.4.1 foundation

Manual metadata editing with durable user-authoritative overrides.

## Metadata editor

- Every comic ellipsis menu now includes **Edit metadata**.
- Edit title, series, issue and volume, publisher, publication year, format,
  storyline, writers, artists, genres, tags, and summary.
- Manual values override filenames, embedded `ComicInfo.xml`, and confirmed
  online matches without modifying the CBZ or CBR archive.
- A visible `EDIT` badge identifies comics with active manual overrides.
- **Reset manual edits** restores the values supplied by the filename,
  archive, folder structure, and confirmed online match.
- Overrides survive Quick Scan, Full Rebuild, file moves, service restarts,
  and in-place SPK upgrades.
- Backup and Restore now includes manual metadata overrides, including preview
  counts and rollback protection.
- Effective manual values are also used in search, publisher shelves, reader
  headings, and OPDS feeds.

## Archive compatibility

- Includes content-signature detection from build 1020: ZIP archives mislabeled
  `.cbr` and RAR archives mislabeled `.cbz` open with the correct reader.
- Extension mismatches appear as non-blocking scan warnings.

## Validation

- 40 automated tests cover manual-edit precedence, rebuild and restart
  persistence, reset, HTTP APIs, backup/restore, OPDS, and archive detection.
- Comic archives remain read-only and provider credentials remain excluded
  from backups.

## Previous 0.4.0 foundation

Portable backup and restore, plus clearer chronology sequence chips.

## Backup and restore

- Library settings now provides **Export backup** and **Restore backup**.
- The versioned JSON backup contains source paths and organization profiles,
  manual reading orders, confirmed metadata matches, and the exporting
  browser's progress, shelf statuses, skipped chronology folders, selected
  library view, and reader mode.
- Comic archives, generated covers, scan indexes, logs, and metadata-provider
  credentials are excluded.
- Restore validates the file and previews source, reading-order, metadata,
  progress, and skipped-folder counts before replacing current data.
- Disconnected USB sources remain configured and are reported in the preview.
- A quick scan starts after restoration to rebuild local index and cover data.
- NAS-side restore writes roll back to the previous configuration, reading
  orders, and matches if any restore step fails.

## Chronology cards

- The top-right chronology chip now shows the branch-relative display sequence
  `1`, `2`, `3`, and so on.
- Raw folder prefixes such as `000.101` are no longer displayed in the chip.
- The numeral is substantially larger while skipped-folder styling remains.

## Upgrade behavior

- Existing sources, library index data, reading orders, metadata matches,
  progress, shelf status, skipped folders, views, and OPDS access survive an
  in-place update.
- No full rebuild is required after upgrading.

## Validation

- Automated HTTP coverage verifies backup export, credential exclusion,
  preview counts, restore, browser-state round trips, OPDS, and archive access.
- Existing archive, scan, metadata, ordering, reader, UI, and migration tests
  remain enabled.
- SPK structure, restricted privilege, DSM shortcut metadata, checksums, and
  bundled runtime are validated during packaging.

## Preview limitations

- Browser state in a backup belongs to the browser that creates it. Restoring
  applies that state to the browser performing the restore.
- Metadata-provider tokens are intentionally not backed up and must be entered
  again after a fresh installation.
- PanelShelf remains intended for a trusted LAN until accounts and access
  authentication are implemented.
