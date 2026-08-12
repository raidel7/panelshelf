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
