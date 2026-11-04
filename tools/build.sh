#!/bin/sh
# Copy only what the site needs into dist/ (for hosts that upload a folder, e.g. `wrangler pages deploy dist`).
# The repository root itself is already a deployable static site; this just leaves out tools, tests and node_modules.
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist
cp -R index.html app src vendor data _headers dist/
echo "dist: $(du -sh dist | cut -f1)"
