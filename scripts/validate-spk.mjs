#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourcePrivilegePath = resolve(projectDir, "synology/conf/privilege");
const sourceLicensePath = resolve(projectDir, "LICENSE");
const sourceUiConfigPath = resolve(projectDir, "synology/ui/config");
const sourceInfoPath = resolve(projectDir, "synology/INFO.template");
const sourceWindowPagePath = resolve(projectDir, "synology/ui/index.html");
const sourceWindowScriptPath = resolve(projectDir, "synology/ui/window.js");

// Where DSM serves a package's dsmuidir from. Not a constant anybody is free
// to pick: Package Center links the folder to
// /usr/syno/synoman/webman/3rdparty/[package name], so the path is the package
// name from INFO, and renaming the package silently moves the page the DSM
// window is pointed at. Derived here rather than written down twice.
const packageName = /^package="?([^"\n]+)"?$/m.exec(
  readFileSync(sourceInfoPath, "utf8"),
)?.[1];
if (!packageName) {
  console.error("SPK validation failed: INFO.template does not name the package.");
  process.exit(1);
}
const dsmWindowUrl = `/webman/3rdparty/${packageName}/index.html`;

function fail(message) {
  console.error(`SPK validation failed: ${message}`);
  process.exit(1);
}

function validatePrivilege(raw, label) {
  let privilege;
  try {
    privilege = JSON.parse(raw);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }

  if (privilege?.defaults?.["run-as"] !== "package") {
    fail(`${label} must set defaults.run-as to "package".`);
  }

  const serialized = JSON.stringify(privilege);
  if (serialized.includes('"run-as":"root"') || serialized.includes('"run-as":"system"')) {
    fail(`${label} requests elevated execution.`);
  }

  if ("executable" in privilege || "tool" in privilege || "ctrl-script" in privilege) {
    fail(`${label} contains an unnecessary privilege override.`);
  }
}

function validateUiConfig(raw, label) {
  let uiConfig;
  try {
    uiConfig = JSON.parse(raw);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }

  const app = uiConfig?.[".url"]?.["com.panelshelf.App"];
  if (!app) {
    fail(`${label} does not define com.panelshelf.App.`);
  }
  // Synology's two words for two behaviours: "url" throws the browser into a
  // new tab, "legacy" draws the page in a window on the DSM desktop. The
  // second is the point of this file, and a change back to the first would
  // look like a working package while quietly undoing it.
  if (app.type !== "legacy") {
    fail(`${label} must define PanelShelf as a legacy application, or DSM opens it in a tab instead of a window.`);
  }
  if (app.url !== dsmWindowUrl) {
    fail(`${label} must open ${dsmWindowUrl}, which is where DSM serves this package's UI folder.`);
  }
  if (!app.icon || !app.title) {
    fail(`${label} must give the application an icon and a title.`);
  }
}

/// The page DSM puts in that window. It is served from DSM's origin, so it
/// always loads; what it does next depends on whether the library on 8251 can
/// be framed, and it has to be able to fall back when it cannot.
function validateWindowPage(html, script, label) {
  for (const [pattern, missing] of [
    [/id="frame"/, "the frame the library is drawn in"],
    [/id="fallback"/, "the fallback shown when it cannot be"],
    [/id="open"/, "the link that opens the library in its own tab"],
    [/src="window\.js"/, "the script that chooses between them"],
  ]) {
    if (!pattern.test(html)) {
      fail(`${label} is missing ${missing}.`);
    }
  }
  if (!/PANELSHELF_PORT\s*=\s*8251\b/.test(script)) {
    fail(`${label} must point at port 8251, the port the package pins.`);
  }
  if (!/location\.protocol\s*===\s*"https:"/.test(script)) {
    fail(`${label} must still work when DSM is open over HTTPS, which cannot frame plain HTTP.`);
  }
}

validatePrivilege(readFileSync(sourcePrivilegePath, "utf8"), "source conf/privilege");
validateUiConfig(readFileSync(sourceUiConfigPath, "utf8"), "source ui/config");
validateWindowPage(
  readFileSync(sourceWindowPagePath, "utf8"),
  readFileSync(sourceWindowScriptPath, "utf8"),
  "source ui window page",
);

const spkPath = process.argv[2];
if (spkPath) {
  const archiveEntries = execFileSync("tar", ["-tf", spkPath], {
    encoding: "utf8",
  }).split("\n");

  if (!archiveEntries.includes("conf/privilege")) {
    fail("built package does not contain conf/privilege.");
  }

  // DSM shows this on the install screen and asks for agreement to it. Losing
  // it would not break the package, which is exactly why it needs checking:
  // the install would simply stop mentioning the licence and nothing would say
  // so.
  if (!archiveEntries.includes("LICENSE")) {
    fail("built package does not contain LICENSE, so DSM will not show it at install.");
  }
  const packagedLicense = execFileSync("tar", ["-xOf", spkPath, "LICENSE"], {
    encoding: "utf8",
  });
  if (packagedLicense !== readFileSync(sourceLicensePath, "utf8")) {
    fail("packaged LICENSE does not match the repository's.");
  }

  const packagedPrivilege = execFileSync(
    "tar",
    ["-xOf", spkPath, "conf/privilege"],
    { encoding: "utf8" },
  );
  validatePrivilege(packagedPrivilege, "packaged conf/privilege");

  const tempDir = mkdtempSync(join(tmpdir(), "panelshelf-spk-validation-"));
  const payloadArchive = join(tempDir, "package.tgz");
  try {
    const payloadBytes = execFileSync(
      "tar",
      ["-xOf", spkPath, "package.tgz"],
      { maxBuffer: 128 * 1024 * 1024 },
    );
    writeFileSync(payloadArchive, payloadBytes);
    const fromPayload = (entry) =>
      execFileSync("tar", ["-xOf", payloadArchive, entry], { encoding: "utf8" });
    validateUiConfig(fromPayload("./ui/config"), "packaged ui/config");
    validateWindowPage(
      fromPayload("./ui/index.html"),
      fromPayload("./ui/window.js"),
      "packaged ui window page",
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

console.log(
  "SPK validation passed: restricted privileges, a DSM window that falls back to\n" +
    "  a tab when it cannot frame the library, and the licence DSM shows at\n" +
    "  install are all correct.",
);
