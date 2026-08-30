#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${PROJECT_DIR}/build"
STAGE_DIR="${BUILD_DIR}/stage"
PAYLOAD_DIR="${STAGE_DIR}/payload"
OUTER_DIR="${STAGE_DIR}/outer"
DIST_DIR="${PROJECT_DIR}/dist"
VERSION="${PANELSHELF_VERSION:-0.4.17-1040}"
ARCH="${PANELSHELF_ARCH:-x86_64}"
NODE_PACKAGE_VERSION="${PANELSHELF_NODE_VERSION:-22.23.1}"
NPM_CACHE_DIR="${PANELSHELF_NPM_CACHE:-/tmp/panelshelf-npm-cache}"

case "${ARCH}" in
  x86_64)
    NODE_RUNTIME_PACKAGE="node-linux-x64"
    ;;
  armv8)
    NODE_RUNTIME_PACKAGE="node-linux-arm64"
    ;;
  armv7)
    NODE_RUNTIME_PACKAGE="node-linux-armv7l"
    ;;
  *)
    echo "Unsupported Synology architecture: ${ARCH}" >&2
    exit 1
    ;;
esac

rm -rf "${STAGE_DIR}"
mkdir -p \
  "${PAYLOAD_DIR}/app" \
  "${PAYLOAD_DIR}/bin" \
  "${PAYLOAD_DIR}/licenses" \
  "${PAYLOAD_DIR}/port_conf" \
  "${PAYLOAD_DIR}/ui/images" \
  "${OUTER_DIR}/scripts" \
  "${OUTER_DIR}/conf" \
  "${DIST_DIR}"

if [[ ! -d "${PROJECT_DIR}/server/node_modules/node-unrar-js" ]]; then
  npm --cache="${NPM_CACHE_DIR}" --prefix "${PROJECT_DIR}/server" install --omit=dev
fi

NODE_RUNTIME_DIR="${BUILD_DIR}/node-runtime-${ARCH}"
if [[ -n "${PANELSHELF_NODE_BINARY:-}" ]]; then
  NODE_BINARY="${PANELSHELF_NODE_BINARY}"
else
  if [[ ! -x "${NODE_RUNTIME_DIR}/node_modules/${NODE_RUNTIME_PACKAGE}/bin/node" ]]; then
    mkdir -p "${NODE_RUNTIME_DIR}"
    npm --cache="${NPM_CACHE_DIR}" \
      --prefix "${NODE_RUNTIME_DIR}" \
      install --no-save --ignore-scripts --force \
      "${NODE_RUNTIME_PACKAGE}@${NODE_PACKAGE_VERSION}"
  fi
  NODE_BINARY="${NODE_RUNTIME_DIR}/node_modules/${NODE_RUNTIME_PACKAGE}/bin/node"
fi

if [[ ! -x "${NODE_BINARY}" ]]; then
  echo "Node runtime was not found at ${NODE_BINARY}." >&2
  exit 1
fi

cp -a "${PROJECT_DIR}/server/src" "${PAYLOAD_DIR}/app/"
cp -a "${PROJECT_DIR}/server/public" "${PAYLOAD_DIR}/app/"
cp "${PROJECT_DIR}/server/package.json" "${PAYLOAD_DIR}/app/package.json"
mkdir -p "${PAYLOAD_DIR}/app/node_modules"
cp -a \
  "${PROJECT_DIR}/server/node_modules/node-unrar-js" \
  "${PAYLOAD_DIR}/app/node_modules/"
cp "${NODE_BINARY}" "${PAYLOAD_DIR}/bin/node"
chmod 0755 "${PAYLOAD_DIR}/bin/node"

NODE_LICENSE="$(dirname "${NODE_BINARY}")/../LICENSE"
if [[ -f "${NODE_LICENSE}" ]]; then
  cp "${NODE_LICENSE}" "${PAYLOAD_DIR}/licenses/Node.js-LICENSE"
fi
UNRAR_LICENSE="${PROJECT_DIR}/server/node_modules/node-unrar-js/LICENSE.md"
if [[ -f "${UNRAR_LICENSE}" ]]; then
  cp "${UNRAR_LICENSE}" "${PAYLOAD_DIR}/licenses/node-unrar-js-LICENSE.md"
fi
cp "${PROJECT_DIR}/THIRD_PARTY_NOTICES.md" "${PAYLOAD_DIR}/licenses/"

cp -a "${PROJECT_DIR}/synology/port_conf/." "${PAYLOAD_DIR}/port_conf/"
cp -a "${PROJECT_DIR}/synology/ui/." "${PAYLOAD_DIR}/ui/"

# The icon was drawn here from ImageMagick primitives; it is now real artwork,
# shared with the iPad app, committed at `assets/panelshelf-icon.png`.
#
# DSM does not mask package icons the way iOS does, so the rounded corners have
# to be in the file and the area outside them has to be genuinely transparent.
# Rounding at each final size rather than shrinking one pre-rounded master keeps
# the corner crisp at 16px, where a resampled curve turns to mush.
#
# `-compose CopyOpacity` and not the shorter `DstIn` form: DstIn silently
# produced an opaque black corner instead of a transparent one. `convert` and
# not `magick`: ImageMagick 6 has no `magick` binary, and the runner's version
# is not pinned.
ICON_MASTER="${PROJECT_DIR}/assets/panelshelf-icon.png"

round_icon() {
  local size="$1"
  local out="$2"
  local radius=$(( (size * 27 + 50) / 100 ))
  convert "${ICON_MASTER}" -resize "${size}x${size}" \
    \( -size "${size}x${size}" xc:none -fill white \
       -draw "roundrectangle 0,0 $((size - 1)),$((size - 1)) ${radius},${radius}" \) \
    -alpha Off -compose CopyOpacity -composite "${out}"
}

for size in 16 24 32 48 64 72 256; do
  round_icon "${size}" "${PAYLOAD_DIR}/ui/images/panelshelf_${size}.png"
done
round_icon 64 "${OUTER_DIR}/PACKAGE_ICON.PNG"
round_icon 256 "${OUTER_DIR}/PACKAGE_ICON_256.PNG"

sed \
  -e "s/__VERSION__/${VERSION}/g" \
  -e "s/__ARCH__/${ARCH}/g" \
  "${PROJECT_DIR}/synology/INFO.template" > "${OUTER_DIR}/INFO"
cp -a "${PROJECT_DIR}/synology/scripts/." "${OUTER_DIR}/scripts/"
cp -a "${PROJECT_DIR}/synology/conf/." "${OUTER_DIR}/conf/"
chmod 0755 "${OUTER_DIR}/scripts/"*

# GNU tar exits non-zero if a file changes while it is being read, which a live
# data directory can do, and both flags exist to tolerate that. bsdtar — which
# macOS ships — accepts neither and does not need them, so the build has to ask
# which tar it has rather than assume the Linux one. Unquoted on purpose: the
# flags have to word-split, and an empty value must vanish.
TAR_TOLERANT_FLAGS=""
if tar --version 2>/dev/null | head -1 | grep -qi "gnu tar"; then
  TAR_TOLERANT_FLAGS="--warning=no-file-changed --ignore-failed-read"
fi

# shellcheck disable=SC2086
tar ${TAR_TOLERANT_FLAGS} \
  -czf "${OUTER_DIR}/package.tgz" -C "${PAYLOAD_DIR}" .

SPK_NAME="PanelShelf-${ARCH}-${VERSION}.spk"
tar -cf "${DIST_DIR}/${SPK_NAME}" -C "${OUTER_DIR}" \
  INFO \
  PACKAGE_ICON.PNG \
  PACKAGE_ICON_256.PNG \
  package.tgz \
  scripts \
  conf

node "${PROJECT_DIR}/scripts/validate-spk.mjs" "${DIST_DIR}/${SPK_NAME}"
(
  cd "${DIST_DIR}"
  sha256sum "${SPK_NAME}" > "${SPK_NAME}.sha256"
)
echo "${DIST_DIR}/${SPK_NAME}"
