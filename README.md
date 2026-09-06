# PanelShelf

**Your comics, quietly organized.**

A comic library and reader that installs on your Synology NAS like any other
package. Point it at the folders you already have, and read in any browser on
the house. It never modifies, moves, or renames a single archive.

![PanelShelf browsing a chronology by publication year](assets/screenshots/chronology-timeline.png)

**[Download](../../releases/tag/nightly)** ·
[Supported models](SUPPORTED_MODELS.md) ·
[Privacy](PRIVACY.md) ·
[Technical reference](docs/TECHNICAL.md)

> **This is a preview.** PanelShelf is built to sit on a home LAN. It has no user
> accounts and terminates no TLS of its own — don't forward its port to the
> internet. [What that means, exactly](docs/TECHNICAL.md#security-scope).

---

## No Docker

No Container Manager, no `compose.yaml`, no bind mounts to get right, no reverse
proxy to stand up before you can see a cover. Install the `.spk` and PanelShelf
is a DSM application: an icon on the desktop, start and stop from Package
Center, its own firewall port, and logs where DSM keeps logs.

- **It runs where Container Manager doesn't.** Docker coverage across Synology's
  ARM range is partial and the value line has largely gone without. PanelShelf
  publishes `x86_64`, `armv8` and `armv7` packages.
- **43 MB, one runtime dependency.** A Node runtime, the server, and
  `node-unrar-js` for CBR. Nothing to pull at install time.
- **DSM owns the lifecycle.** Starts on boot, stops on shutdown, upgrades in
  place. No restart policy to reason about.
- **Your comics stay where they are.** Internal or USB, read in place.

---

## What you get

### Your library, filed the way you filed it

- Recursive CBZ and CBR scanning across as many internal and USB folders as you
  like
- **Organization profiles per source** — loose issues, folders as series,
  hierarchical timeline, or an exact reading order — so a tidy chronology and a
  dumping ground can live in the same library without pretending to be alike
- Reads the structure and tells you what it found *before* you commit: detected
  layout, recognized publishers, folder roles, and what didn't validate
- Chronological browsing with numbered rails, timeline visualization, skippable
  branches, and an Unfiled shelf for `_` staging folders — which get a place to
  sit rather than an invented position in your chronology
- A comic keeps its identity when you move the file
- A disconnected USB drive keeps its comics on the shelf, badged, instead of
  silently emptying it

### Reading

- Full-screen browser reader — single page, double page, manga right-to-left,
  and continuous scroll
- Fit-width and fit-height, keyboard and touch
- **Continue Reading**, plus Unread / In progress / Completed / Skipped on every
  comic
- **Next Comic that knows where it is** — folder and series contexts stop at
  their boundary, manual orders cross wherever you told them to, and anything
  marked Skipped is skipped
- **Reading orders** you build by drag and drop across folders and series, with
  their own cover artwork, exportable, importable, and repairable when files
  move
- Reader profiles, so two people in the house don't overwrite each other's page

![A double-page spread in the browser reader](assets/screenshots/reader-double-page.png)

### Metadata, only when you ask for it

- Reads embedded `ComicInfo.xml` — title, series, issue, volume, year,
  publisher, creators, genres, summary
- **Optional** matching against the Grand Comics Database, Metron, and Open
  Library — manual, scored, reviewed by you, cached once confirmed, and never
  running in the background
- **A library scan never contacts a provider.** Nothing leaves the machine
  unless you press the button. [Privacy policy](PRIVACY.md)
- Falls back to the year in the filename when there's nothing better, and gives
  that up the moment there is
- Bulk editing from a search, and a duplicate review that reports rather than
  deletes

### Read it in the app you already use

- Read-only **OPDS 1.2** catalogs — all comics, publishers, folders, search, and
  your reading orders
- **Page streaming**, so a third-party reader fetches pages as you turn them
  instead of downloading a whole archive to show you page one
- Opens on the page you stopped at, wherever you stopped

### Runs like a NAS app, not like a project

- **Cover cache with a ceiling** it holds to — a sleeping USB disk is never woken
  to draw a shelf
- **Scheduled scans** at an hour nobody is reading
- **Source health** that tells you which drive is disconnected, slow, or handing
  back files it can't read
- **Upgrades keep a checkpoint** of the index they're about to change, and an
  index written by a newer build is never rewritten by an older one
- **Backup and restore** for sources, reading orders, confirmed matches and
  progress
- A **support bundle** that collects what a bug report needs, with the paths and
  names taken out
- A log that cannot fill your volume

---

## Install

1. **DSM → Package Center → Manual Install**
2. Pick the package for your NAS — `PanelShelf-x86_64-0.5.1-1043.spk` for
   Intel/AMD, `armv8` or `armv7` for ARM. **Control Panel → Info Center** names
   your CPU. ([Which models are tested](SUPPORTED_MODELS.md))
3. Accept the third-party package warning
4. Start it, click **Open** — or visit `http://YOUR-NAS-IP:8251/`
5. **Library settings** → browse to a comics folder → review what it detected →
   **Save and scan**

That's it. Browse **All comics**, **Publishers**, or **Chronological**.

### Downloads

- **[Nightly](../../releases/tag/nightly)** — rebuilt from `main`, with SPKs for
  all three architectures plus `.sha256` files
- **[Versioned releases](../../releases)** — cut from a `v*` tag

Packages are unsigned, so install through **Manual Install** and allow packages
from any publisher. Every build is attested to the commit and workflow that
produced it — [how to verify one](SUPPORTED_MODELS.md).

---

## Documentation

| | |
| --- | --- |
| [Technical reference](docs/TECHNICAL.md) | Security model, HTTP and OPDS API, scanning rules, DSM behaviour, building it yourself |
| [Supported models](SUPPORTED_MODELS.md) | What's been run on real hardware and what merely builds |
| [Privacy](PRIVACY.md) | What leaves the machine, and when |
| [Security](SECURITY.md) | Reporting a vulnerability privately |
| [Release notes](RELEASE_NOTES.md) | What changed, build by build |
| [Roadmap](ROADMAP.md) | Where this is going and what's still missing |
| [Contributing](CONTRIBUTING.md) | Working on it |

## License

MIT. See [LICENSE](LICENSE) — it's also shown on the DSM install screen, and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) covers what ships alongside.
