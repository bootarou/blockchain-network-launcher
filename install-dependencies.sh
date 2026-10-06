#!/bin/bash
set -euo pipefail

cd "${1:?Usage: install-dependencies.sh DIRECTORY}"
test -f package.json
test -f package-lock.json

manifests=$(sha256sum package.json package-lock.json)
runtime=$(node -p 'JSON.stringify([process.version, process.platform, process.arch, process.versions.modules])')
npm_version=$(npm --version)
fingerprint=$(printf '%s\n' "$manifests" "$runtime" "$npm_version" 'bnl-dependencies-v1 include=dev' | sha256sum | cut -d ' ' -f 1)
marker=node_modules/.bnl-dependencies
if [ -f "$marker" ] && [ "$(cat "$marker")" = "$fingerprint" ]; then
  echo "[Setup] Dependencies current: $PWD"
  exit 0
fi

echo "[Setup] Synchronizing dependencies: $PWD"
# Invalidate before installation so failures and interrupted installs retry.
rm -f "$marker"
npm ci --include=dev --no-audit --no-fund
printf '%s\n' "$fingerprint" > "$marker"
echo "[Setup] Dependencies ready: $PWD"
