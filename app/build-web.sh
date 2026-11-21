#!/usr/bin/env bash
# Builds the web app and copies it into the server, where it is served at /play.
set -e
cd "$(dirname "$0")"
rm -rf dist-web
npx expo export -p web --output-dir dist-web
rm -rf ../server/public/_expo ../server/public/assets
cp -r dist-web/_expo ../server/public/_expo
cp -r dist-web/assets ../server/public/assets
cp dist-web/index.html ../server/public/play.html
echo "web build copied to server/public (served at /play)"
