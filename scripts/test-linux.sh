#!/usr/bin/env bash
# 在 Linux 容器内复跑测试。
#
# 为什么需要它:有几条测试在 Windows 上会**静默失效**而不是失败 ——
#   - fs-tenant 的符号链接逃逸:Windows 非管理员建不了 symlink,于是三条
#     最关键的防线测试跑了个空
#   - 上游 dsh-subprocess-local 的 PTY:win32 平台根本不支持(见
#     docs/FEASIBILITY-REPORT.md 验证 D)
#
# 静默失效比失败危险得多:CI 是绿的,而防线从未被验证过。
#
# 用法:docker run --rm -v "$PWD:/src:ro" -w / node:24 bash /src/scripts/test-linux.sh [vitest 参数]
set -euo pipefail

WORK=/tmp/dshwar
mkdir -p "$WORK"

# 排除 node_modules 与构建产物:容器要用 Linux 的原生依赖重装一遍
tar -C /src --exclude=node_modules --exclude=dist --exclude=.git \
    --exclude='*.tsbuildinfo' --exclude=feasibility -cf - . | tar -C "$WORK" -xf -

cd "$WORK"

corepack enable >/dev/null 2>&1
corepack prepare pnpm@11.12.0 --activate >/dev/null 2>&1

echo "--- 容器环境 ---"
echo "node $(node --version) · pnpm $(pnpm --version) · $(uname -srm)"
echo ""

pnpm install --no-frozen-lockfile >/dev/null 2>&1 || pnpm install --no-frozen-lockfile
pnpm build >/dev/null 2>&1

echo ""
pnpm exec vitest run "$@"
