#!/usr/bin/env bash
set -euo pipefail
mkdir -p /tmp/fz2
cp -r /src/package.json /src/pnpm-workspace.yaml /src/verify /tmp/fz2/
cd /tmp/fz2
corepack enable >/dev/null 2>&1
corepack prepare pnpm@11.12.0 --activate >/dev/null 2>&1
echo "--- 容器环境 ---"
echo "node $(node --version) · $(uname -srm)"
echo ""
pnpm install --no-frozen-lockfile >/dev/null 2>&1 || pnpm install --no-frozen-lockfile
node verify/run-all.ts
