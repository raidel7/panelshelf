# Security policy

## Reporting a vulnerability

Please report security issues privately, not as a public issue.

Use GitHub's [private vulnerability reporting](https://github.com/raidel7/panelshelf/security/advisories/new)
on this repository. That opens a draft advisory only you and the maintainer can
see.

Please include what you were able to do, the steps to reproduce it, the
PanelShelf version from `/api/health`, and your DSM version and model. A
proof-of-concept request or short script helps more than a description.

You should get an acknowledgement within a week. PanelShelf is maintained by
one person in their spare time, so a fix may take longer than that — you will
be told where it stands rather than left waiting.

## Supported versions

PanelShelf is in preview. Only the most recent release receives fixes. There is
no backporting to earlier builds.

## What PanelShelf does not defend against

These are known and documented rather than accidental, so please do not report
them as vulnerabilities. They are on the roadmap.

- **No authentication by default.** A fresh install answers anything that can
  reach port 8251, and that is deliberate: turning pairing on locks out every
  client that has not paired, which is the owner's decision to make rather than
  an upgrade's. Device pairing can be switched on in Library settings, after
  which every API and OPDS request needs a device token. There are still no user
  accounts — everyone paired shares one library and one reading position.
  Accounts are section 8 of `ROADMAP.md`.
- **Locking yourself out is possible.** If pairing is on and every paired client
  has lost its token, nothing in the browser can undo it. Recovery means editing
  `devices.json` in the package's data directory and setting `enabled` to
  `false`, which needs shell access to the NAS.
- **No TLS.** PanelShelf serves plain HTTP and terminates no TLS of its own.
- **No multi-user separation.** Reading progress is a single shared store, so
  everyone using one server shares one reading position per comic.

PanelShelf is meant to run on a home LAN, behind a VPN, or behind an
authenticated HTTPS reverse proxy. Do not forward port 8251 to the internet.

## What is in scope

Anything that lets a request do more than the above already allows. For
example:

- reaching the API from another origin, or through a forged `Host`, in spite of
  the checks in `guardRequest`
- reaching any guarded route without a device token while pairing is on, or
  keeping access after the device was revoked
- a device token appearing in a response, a log line, or `devices.json`, which
  stores only a SHA-256 of each one
- reading or writing a path outside the configured library sources, including
  through `GET /api/folders` or an archive entry that escapes its extraction
  directory
- crashing or hanging the server with a single request, which takes the library
  away from everyone on the LAN
- a saved Metron token being returned to a client or written to a log

## Third-party metadata providers

PanelShelf queries external metadata services only after an explicit user
search, and only when the NAS owner has supplied credentials. Issues in those
services belong to them. Issues in how PanelShelf stores or transmits their
credentials belong here.
