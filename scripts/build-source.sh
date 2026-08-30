#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${PROJECT_DIR}/dist"
VERSION="${PANELSHELF_VERSION:-0.4.16-1039}"
ARCHIVE="${DIST_DIR}/PanelShelf-source-${VERSION}.zip"

mkdir -p "${DIST_DIR}"
rm -f "${ARCHIVE}" "${ARCHIVE}.sha256"

(
  cd "${PROJECT_DIR}"
  zip -qr "${ARCHIVE}" \
    LICENSE \
    README.md \
    RELEASE_NOTES.md \
    ROADMAP.md \
    THIRD_PARTY_NOTICES.md \
    package.json \
    scripts \
    server/package.json \
    server/package-lock.json \
    server/public \
    server/src \
    server/test \
    synology
)

(
  cd "${DIST_DIR}"
  sha256sum "$(basename "${ARCHIVE}")" > "$(basename "${ARCHIVE}").sha256"
)
echo "${ARCHIVE}"
