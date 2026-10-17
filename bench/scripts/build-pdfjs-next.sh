#!/usr/bin/env bash
# Build unreleased pdf.js master (with its renderer worker) into bench/vendor/.
# Usage: bench/scripts/build-pdfjs-next.sh [commit]
set -euo pipefail

commit="${1:-157d30e}"
vendor="$(cd "$(dirname "$0")/.." && pwd)/vendor"
mkdir -p "$vendor"
cd "$vendor"
if [ ! -d pdf.js ]; then
  git clone --quiet --filter=blob:none https://github.com/mozilla/pdf.js.git
fi
cd pdf.js
git fetch --quiet origin
git checkout --quiet "$commit"
PUPPETEER_SKIP_DOWNLOAD=1 npm ci --no-audit --no-fund --loglevel=error
npx gulp generic
# The ~600 MB of build-only dependencies are not needed to run the benchmark.
if [ -z "${KEEP_DEPS:-}" ]; then
  rm -rf node_modules
fi
echo "Built pdf.js $(git rev-parse --short HEAD) into $vendor/pdf.js/build/generic"
