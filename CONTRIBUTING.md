# Contributing to PanelShelf

Thanks for looking. PanelShelf is a comic library and reader packaged natively
for Synology DSM, maintained by one person, so the most useful contributions
are usually small and specific.

## The most valuable thing you can send

**A compatibility report.** PanelShelf is developed against one NAS — a
DS1825+, x86-64, DSM 7.2. The ARM packages are cross-built and have not been
run on representative hardware. If you install it on anything else, please open
a *Compatibility report* issue and say what happened, whether it worked or not.
That is information no amount of code review can produce.

## Getting set up

You need Node.js 18 or newer and npm. No other toolchain is required to run the
server or the tests.

```bash
npm run install:server
npm test                                        # 197 tests, no network, no NAS
PANELSHELF_DATA=/tmp/panelshelf-data npm start  # http://localhost:8251/
```

The server needs no NAS to run. Point a library source at any folder of CBZ or
CBR files and the browser reader works exactly as it does on DSM.

## Checking a server

```bash
npm run conformance -- http://localhost:8251
```

Points at a running server and checks it against the contract in `README.md`.
Useful after changing anything a client depends on, and safe against a real
library — it writes nothing unless you pass `--write`.

## Building a package

```bash
npm run build:spk      # x86_64 SPK into dist/
npm run build:all      # x86_64, armv8 and armv7
npm run validate:spk   # checks a built SPK's structure
```

`build:spk` downloads a pinned Node.js runtime and assembles the SPK. Set
`PANELSHELF_NODE_BINARY` to reuse a compatible binary you already have.

Please do not commit built packages. Releases are published from CI: a push to
`main` refreshes the rolling `nightly` prerelease, and pushing a `v*` tag builds
a full release from `RELEASE_NOTES.md`.

## What a change should look like

**Tests come with behaviour.** Anything that changes what the server does needs
a test that fails without the change. The suite spawns a real server over a
temporary data directory and drives it over HTTP, so a test usually asserts on
a response rather than on an internal call. `server/test/server.test.js` has
the patterns.

**Comments explain why, not what.** The code is not shy about a paragraph above
a function describing the thing that made it necessary — a bug it fixes, a DSM
constraint, an ordering that is load-bearing. Reading the surrounding file will
show you the register.

**Commits explain themselves.** Conventional-commit subjects (`fix(server):`,
`feat:`, `docs:`) with a body describing what was wrong and how you know it is
fixed. "Verified:" lines saying what you actually ran are welcome and expected.

**Keep it focused.** One concern per pull request. If you find something else
along the way, an issue about it is more useful than a bigger diff.

## Things to know before starting something large

- **Authentication is planned, not absent by oversight.** See `SECURITY.md` and
  section 8 of `ROADMAP.md` before proposing an auth scheme.
- **The iPad client lives elsewhere** and is not open source. This repository
  is the server, the browser reader, and the DSM package. Server changes that
  the app depends on are fine; they just need to keep the documented API
  compatible.
- **Metadata providers are deliberately limited.** Provider choices are a
  licensing question as much as a technical one, so please open an issue before
  adding one.
- **`ROADMAP.md` is the plan of record.** If something there looks wrong or out
  of date, saying so is a genuinely useful contribution.

## Reporting a security issue

Do not open a public issue. See [SECURITY.md](SECURITY.md).

## Licence

PanelShelf is MIT licensed. Contributions are accepted under the same licence.
