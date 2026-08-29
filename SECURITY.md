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

- **No authentication.** There are no user accounts, no OPDS authentication and
  no device tokens. Anything that can reach port 8251 can read the library and
  change its settings. Accounts are section 8 of `ROADMAP.md`.
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
