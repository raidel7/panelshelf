# Privacy

PanelShelf runs on your NAS and reads comics you already own. This describes
what it does with them, what it sends anywhere, and when.

It is written against the code rather than around it. Everything below can be
checked in this repository, and the sections say where.

## PanelShelf collects nothing

There is no analytics, no crash reporting, no usage statistics, no update
check, and no account. Nothing is sent to the author of this software, ever,
including when it goes wrong. Nothing in the package calls anywhere on its own
schedule.

## What stays on your NAS

All of it, unless a section below says otherwise:

- Your comics. PanelShelf reads the archives and never writes to them.
- Covers and thumbnails it generates, under the package's own data directory.
- Reading positions, per reader profile.
- Reader profiles, reading orders, skipped branches, manual metadata edits, and
  chosen artwork.
- The library index: paths, titles, series, and anything read from a
  `ComicInfo.xml` inside an archive.
- Paired devices, stored as hashes rather than as the tokens themselves.

## What leaves your NAS, and when

**Metadata matching, and only when you ask for it.** A search sends the least
that will identify the comic, and no more — the Grand Comics Database is asked
about the series and the issue is chosen locally from what comes back:

| Provider | Host | What a search sends | Default |
| --- | --- | --- | --- |
| Grand Comics Database | `comics.org` | The series name, and the year when there is one | Available |
| Open Library | `openlibrary.org` | The series and title as one search phrase, and only for collected editions | Available |
| Metron | `metron.cloud` | Series, issue number, year and publisher | Off, and needs a token you supply |

No file, no page, no cover, and nothing about what anybody has read is sent to
any of them.

Available means the provider can be used, not that anything has been sent. **A
library scan never contacts a provider.** Scanning reads your disk and nothing
else, so a fresh install can index a library of any size having sent nothing
anywhere. Matching is a separate action you start, on the comics you choose,
and a scheduled scan will not do it unless you turn that on — it defaults off
for this reason.

Providers see your IP address, as any web request does. They do not see your
library.

**Announcements on your local network.** So clients can find the server without
being told an address, PanelShelf announces its name, port, and version over
mDNS to `224.0.0.251:5353`. This is the same mechanism printers and speakers
use. It stays on your local network and carries nothing about your library.
Anyone on that network can see it.

## Other people on your network

PanelShelf has no accounts and no passwords. Until you turn on device pairing,
anyone who can reach the port can read the library. Pairing is the boundary,
and reader profiles are not — a profile is a namespace for reading positions,
not a login, and it grants nothing.

Do not forward the port to the internet. There is no threat model in which that
is a good idea for software that is one person's spare-time project, and the
documented setups all put a reverse proxy in front of it.

## The support bundle

**Library settings → Download support bundle** builds a diagnostic file and
downloads it to your device. PanelShelf does not send it anywhere; where it
goes next is entirely your decision.

It contains, and says so at the top of the file itself: versions and
configuration, the full path of every source folder, counts of comics and
reading positions, the names and dates of paired devices, the account the
server runs as, and the tail of the log. Tokens, keys and their masked hints
are stripped, and nothing about which comics anyone has read is in it.

Source paths can contain a person's name. Read the file before attaching it to
a public issue.

## Deleting things

Everything PanelShelf keeps lives in one directory on the NAS, and uninstalling
the package removes it. Removing a source drops its comics from the index.
Revoking a paired device takes effect on that device's next request.

## Questions

Anything this does not answer, or anything here that turns out not to match
what the code does, belongs in an issue on the repository. Security problems
belong in [SECURITY.md](SECURITY.md) instead, which asks you to report them
privately.
