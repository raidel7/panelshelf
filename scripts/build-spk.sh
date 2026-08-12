#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${PROJECT_DIR}/build"
STAGE_DIR="${BUILD_DIR}/stage"
PAYLOAD_DIR="${STAGE_DIR}/payload"
OUTER_DIR="${STAGE_DIR}/outer"
DIST_DIR="${PROJECT_DIR}/dist"
VERSION="${PANELSHELF_VERSION:-0.4.5-1026}"
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

ICON_SOURCE="${BUILD_DIR}/panelshelf-icon-master.png"
convert -size 256x256 xc:none \
  -fill "#211d2b" -stroke none \
  -draw "roundrectangle 0,0 255,255 68,68" \
  -fill "#907cf3" \
  -draw "roundrectangle 60,48 202,208 18,18" \
  -fill none -stroke "#f7f4ff" -strokewidth 12 \
  -draw "line 82,50 82,206 line 101,82 174,82 line 101,108 154,108" \
  -stroke "#fff0a9" -strokewidth 12 \
  -draw "polyline 150,158 164,172 194,137" \
  "${ICON_SOURCE}"
for size in 16 24 32 48 64 72 256; do
  convert "${ICON_SOURCE}" -resize "${size}x${size}" \
    "${PAYLOAD_DIR}/ui/images/panelshelf_${size}.png"
done
convert "${ICON_SOURCE}" -resize 64x64 \
  "${OUTER_DIR}/PACKAGE_ICON.PNG"
convert "${ICON_SOURCE}" -resize 256x256 \
  "${OUTER_DIR}/PACKAGE_ICON_256.PNG"

sed \
  -e "s/__VERSION__/${VERSION}/g" \
  -e "s/__ARCH__/${ARCH}/g" \
  "${PROJECT_DIR}/synology/INFO.template" > "${OUTER_DIR}/INFO"
cp -a "${PROJECT_DIR}/synology/scripts/." "${OUTER_DIR}/scripts/"
cp -a "${PROJECT_DIR}/synology/conf/." "${OUTER_DIR}/conf/"
chmod 0755 "${OUTER_DIR}/scripts/"*

tar --warning=no-file-changed --ignore-failed-read \
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
