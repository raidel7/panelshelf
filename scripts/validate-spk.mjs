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
const sourceUiConfigPath = resolve(projectDir, "synology/ui/config");

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
  if (app.type !== "url") {
    fail(`${label} must define PanelShelf as a URL application.`);
  }
  if (app.protocol !== "http" || String(app.port) !== "8251" || app.url !== "/") {
    fail(`${label} must open http://NAS:8251/.`);
  }
}

validatePrivilege(readFileSync(sourcePrivilegePath, "utf8"), "source conf/privilege");
validateUiConfig(readFileSync(sourceUiConfigPath, "utf8"), "source ui/config");

const spkPath = process.argv[2];
if (spkPath) {
  const archiveEntries = execFileSync("tar", ["-tf", spkPath], {
    encoding: "utf8",
  }).split("\n");

  if (!archiveEntries.includes("conf/privilege")) {
    fail("built package does not contain conf/privilege.");
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
    const packagedUiConfig = execFileSync(
      "tar",
      ["-xOf", payloadArchive, "./ui/config"],
      { encoding: "utf8" },
    );
    validateUiConfig(packagedUiConfig, "packaged ui/config");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

console.log(
  "SPK validation passed: restricted privileges and DSM Open shortcut are correct.",
);
