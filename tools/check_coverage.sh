#!/usr/bin/env bash
# SolarHelm coverage gate: 100% line coverage, enforced.
#
# C++ : gcov/gcovr over lib/ + sim/ after running the unit tests, every
#       simulator scenario and every CLI code path.
# JS  : c8 (istanbul) over the planner/calculator modules via node's test
#       runner (app/tests).
#
# Documented exclusions (the ONLY ones):
#   - firmware/main.cpp        ESP32-only entry stub, cannot execute on desktop
#   - app/sw.js                service worker (browser lifecycle; smoke-tested
#                              in the headless browser check instead)
#   - LCOV_EXCL_LINE markers   compiler-mandated unreachable returns after
#                              exhaustive branches (grep for the marker)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== C++ coverage =="
rm -rf build coverage.info coverage
make -s test
make -s sim
mkdir -p sim/out

# Exercise every sim CLI path (also produces the scenario CSVs).
./build/sim --list > /dev/null
./build/sim --help > /dev/null
./build/sim --out sim/out > /dev/null
./build/sim --profile config/boat_profile.json --out sim/out GPSFailure > /dev/null
if ./build/sim NoSuchScenario 2> /dev/null; then
    echo "expected failure for unknown scenario"; exit 1
fi
if ./build/sim --out /nonexistent/dir DemoB_SuddenSolarDrop 2> /dev/null; then
    echo "expected failure for unwritable output dir"; exit 1
fi
if ./build/sim --profile /nonexistent.json 2> /dev/null; then
    echo "expected failure for missing profile"; exit 1
fi
BAD_PROFILE=$(mktemp)
echo '{"schema_version": 1}' > "$BAD_PROFILE"
if ./build/sim --profile "$BAD_PROFILE" 2> /dev/null; then
    echo "expected failure for malformed profile"; exit 1
fi
rm -f "$BAD_PROFILE"

gcovr --root . \
      --filter 'lib/' --filter 'sim/' --filter 'drivers/' \
      --exclude-throw-branches \
      --print-summary \
      --fail-under-line 100 \
      build

echo "== JS coverage =="
(cd app && npx --yes c8 --check-coverage \
    --lines 100 --functions 100 --statements 100 \
    --include 'js/**/*.js' --exclude 'sw.js' --reporter=text \
    node --test 'tests/*.test.js')

echo "COVERAGE GATE PASSED (100% lines)"
