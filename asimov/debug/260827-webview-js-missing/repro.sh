#!/usr/bin/env bash
# Repro: the webview bundle must build and land at media/webview.js.
# The reporter's symptom is VS Code failing to read that file; it is absent
# because `node esbuild.js` errors out before writing it.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

rm -f media/webview.js
build_out="$(node esbuild.js 2>&1)"
build_status=$?

if [ -f media/webview.js ] && [ "$build_status" -eq 0 ]; then
  echo "OBSERVES 1: GREEN — media/webview.js built"
  exit 0
fi

echo "OBSERVES 1: RED — media/webview.js was not produced (esbuild exit $build_status)"
echo "$build_out" | grep -E '✘|ERROR|Could not resolve' || echo "$build_out" | tail -5
exit 1
