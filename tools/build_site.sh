#!/usr/bin/env bash
# Assembles the deployable website into _site/ (the exact layout GitHub
# Pages serves and tools/browser_smoke.mjs tests):
#
#   _site/
#     index.html, calculator.html, style.css     (from site/)
#     app/                                       (the planner PWA)
#     config/boat_profile.json                   (shared boat model)
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf _site
mkdir -p _site/config
cp site/*.html site/*.css _site/
if [ -d site/assets ]; then cp -r site/assets _site/assets; fi
cp -r app _site/app
rm -rf _site/app/tests _site/app/package.json _site/app/node_modules
cp config/boat_profile.json _site/config/
echo "site assembled in _site/"
