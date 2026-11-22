#!/usr/bin/env bash
# Builds the web version into ../server/public/play.
# Railway's uploader skips any folder named node_modules, so bundled assets are moved to assets/nm and the bundle is rewritten.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d public/dev ] && mv public/dev ../.dev-photos-tmp
trap '[ -d ../.dev-photos-tmp ] && mv ../.dev-photos-tmp public/dev' EXIT
rm -rf dist
npx expo export -p web --output-dir dist
if [ -d dist/assets/node_modules ]; then
  mv dist/assets/node_modules dist/assets/nm
  grep -rl "assets/node_modules/" dist --include=*.js --include=*.html | while read -r f; do sed -i 's#assets/node_modules/#assets/nm/#g' "$f"; done
fi
# paint the page colour before the bundle loads (no white flash on slow networks)
sed -i 's#</head>#<style>html,body{background:\#E9EDE5;margin:0}</style><meta name="theme-color" content="\#E9EDE5"></head>#' dist/index.html
rm -rf ../server/public/play
cp -r dist ../server/public/play
echo "web build -> server/public/play"
