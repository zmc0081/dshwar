#!/usr/bin/env bash
# 在 Linux 容器内复跑同一套验证。目的有两个:
#   1. 验证 D 的 PTY 结论必须在部署目标平台(Linux)上取得,Windows 上的结论不作数
#   2. 顺带确认 A/B/C 的结论不是 Windows 特有的偶然
set -euo pipefail

mkdir -p /tmp/fz
cp -r /src/package.json /src/pnpm-workspace.yaml /src/verify /tmp/fz/
cd /tmp/fz

corepack enable >/dev/null 2>&1
corepack prepare pnpm@11.12.0 --activate >/dev/null 2>&1

echo "--- 容器环境 ---"
echo "node $(node --version) · pnpm $(pnpm --version) · $(uname -srm)"
echo ""

pnpm install --no-frozen-lockfile >/dev/null 2>&1 || pnpm install --no-frozen-lockfile

echo ""
node verify/run-all.ts
