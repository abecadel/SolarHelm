#!/usr/bin/env bash
# Assembles the ESP32 LittleFS image content: the companion app packed
# under data/www/ so the boat serves its own control panel
# (firmware/main.cpp serveStatic). Then flash it with:
#
#   pio run -e esp32s3 -t uploadfs
#
# The shared boat profile is included at the path the app fetches
# (../config/ relative to /www/ collapses to /config/ — LittleFS has no
# parent dirs, so the app's fallback to the built-in profile covers it;
# we ALSO place a copy at /www/config/ for a future same-origin fetch).
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf data
mkdir -p data/www/config
cp -r app/* data/www/
rm -rf data/www/tests data/www/package.json data/www/node_modules \
       data/www/coverage data/www/.nyc_output
cp config/boat_profile.json data/www/config/

SIZE=$(du -sh data | cut -f1)
echo "LittleFS payload assembled in data/ (${SIZE})"
echo "flash it with: pio run -e esp32s3 -t uploadfs"
