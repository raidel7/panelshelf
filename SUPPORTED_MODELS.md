# Supported models

PanelShelf builds three packages. Building one is not the same as supporting
the model, and this file keeps the two apart — a package that has never been
installed on the hardware it targets is a package nobody should be told works.

Minimum DSM is **7.2-64570**, declared in the package itself, so DSM refuses to
install it on anything older.

## Where it stands

| Architecture | Package | Tested on hardware | Status |
| --- | --- | --- | --- |
| `x86_64` | Published | DS1825+, DSM 7.2 | **Supported** |
| `armv8` (arm64) | Published | Not yet | Untested — install at your own risk |
| `armv7` (32-bit ARM) | Published | Not yet | Experimental |

"Untested" is the literal state, not modesty. The ARM packages are built by the
same script from the same source with the matching Node runtime, and there is
no reason to expect them to fail. Nobody has run one.

This will stay accurate rather than aspirational: an architecture moves to
Supported when the install, an upgrade, a scan, and a restart have been done on
one, and not before.

## What was actually tested

One machine, in September 2026:

- **DS1825+**, x86-64, 8 GB RAM, 8 cores, DSM 7.2
- 24,839 comics on a USB disk, roughly half CBZ and half CBR
- Upgraded in place from 0.4.16-1038 to 0.5.1-1043, index migrated, nothing lost
- Full scan, quick scan, scheduled scan, cover cache to its ceiling
- Not tested: power loss, downgrade, uninstall

## What it needs from a model

**Memory is the number to check.** Scanning 24,839 comics peaked at 339 MB on
top of DSM's own usage. The scan is the high-water mark; serving a library
afterwards sits around 240 MB. Extrapolating to 100,000 comics suggests roughly
1.2 GB, which is measured on a laptop rather than on hardware and is the figure
to distrust first.

That makes 2 GB the practical floor for a large library and comfortable for a
small one. A 512 MB model is not a target.

**Disk is mostly covers.** The library index runs about 2 KB per comic. Covers
are capped — 4 GB by default, `PANELSHELF_COVER_CACHE_MB` to change it — and
that cap is a real constraint rather than headroom: a 25,000-comic library
wants 22 GB of full covers and gets 4, which is why the cache gives up full
covers before thumbnails.

**CPU decides how long a scan takes, and the disk decides more.** A full scan
of 24,839 comics over USB took 45 minutes; a quick scan of the same library
took 9 seconds. A slower box scans more slowly and reads no differently.

## ARMv7 has a deadline

The bundled runtime is Node 22, and that is deliberate: Node 24 ships no
`linux-armv7l` build, so moving to it would leave the ARMv7 package with no
runtime at all. Node 22 is the last line carrying 32-bit ARM and is supported
until April 2027.

So ARMv7 is not merely untested, it is on a clock. Before that date it needs
either a maintainable runtime or an honest retirement. It will not be quietly
carried on an unsupported Node.

## Trusting the download

PanelShelf is distributed directly, from the releases page of this repository.
It is not in Synology's marketplace, so Package Center will call it an unknown
publisher and refuse it until **Package Center → Settings → Trust Level** is set
to allow any publisher. That is the only lever DSM gives you; there is no way to
tell it to trust a particular third party.

Which means the package cannot prove anything to DSM, so it proves it to you
instead:

```sh
# The checksum published beside it
sha256sum -c PanelShelf-x86_64-0.5.2-1044.spk.sha256

# Where it came from: this repository, this workflow, this commit
gh attestation verify PanelShelf-x86_64-0.5.2-1044.spk --repo raidel7/panelshelf
```

The second one is the useful one. It checks a signed build provenance record in
a public transparency log, so it says the file was built by this project's
release workflow from a named commit — not merely that it matches a hash
published on the same page as the download.

## If you run one of the untested ones

That is genuinely useful, and the thing that turns a row of this table from
Untested to Supported. What helps: whether it installed, whether a scan
finished, and **Library settings → Download support bundle**, which carries the
architecture, the DSM version, and what the scan cost. Read it before posting
it — it contains your folder paths.
