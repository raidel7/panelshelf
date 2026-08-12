#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for architecture in x86_64 armv8 armv7; do
  PANELSHELF_ARCH="${architecture}" \
    bash "${PROJECT_DIR}/scripts/build-spk.sh"
done
