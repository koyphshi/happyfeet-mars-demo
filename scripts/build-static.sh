#!/usr/bin/env bash
# Static build of the viewer for hosts without Node (GitHub Pages, Netlify, any file server).
# Works: globe (Cesium from the pinned jsDelivr fallback), NASA Trek layers (direct, CORS-open),
# spots, demo excursion + survival card, integrity check, REMS snapshot, VR page.
# Needs the Node server (not available here): planning NEW routes (/terrain), tile cache (/trek),
# live REMS (/rems), custom spots API.
# usage: scripts/build-static.sh <out-dir>
set -euo pipefail
out=${1:?usage: build-static.sh <out-dir>}
src="$(cd "$(dirname "$0")/../web" && pwd)"
mkdir -p "$out"
rsync -a --delete \
  --exclude /node_modules --exclude /data --exclude /.tile-cache --exclude /test \
  --exclude serve.mjs --exclude package.json --exclude package-lock.json \
  --exclude .git --exclude .nojekyll \
  "$src"/ "$out"/
# No node_modules here: load the pinned Cesium build straight from jsDelivr (a document.write
# fallback can be blocked by Chrome on slow connections).
CDN="https://cdn.jsdelivr.net/npm/cesium@1.147.0/Build/Cesium/"
sed -i "s#\./node_modules/cesium/Build/Cesium/#${CDN}#g" "$out/index.html"
grep -v "<!--" "$out/index.html" | grep -q "node_modules/" && { echo "index.html still references node_modules" >&2; exit 1; }
touch "$out/.nojekyll"   # vendor files start with "_" (e.g. _blake.js); Jekyll would drop them
echo "static build -> $out ($(du -sh "$out" | cut -f1))"
