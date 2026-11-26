#!/usr/bin/env bash
# #3291 最小样品一键自测：安装依赖 → typecheck → Vitest → gen:api 校验 → MANIFEST 核验。
#
# 工具选择分两条线（#3066 教训：只按版本号选解释器会跳过自测）：
#   NODE：按版本号 ≥20 选；
#   TEST_NODE：按“能解析 vitest”选——能跑测试的 node 优先；找不到就报错退出，绝不跳过。
# 安装优先 pnpm，失败回退 npm ci（本机 pnpm install 曾因 root 下 chown 报 EPERM；
# npm ci 会先清空 node_modules，所以回退是干净的）。
# MANIFEST 核验说明：MANIFEST 不含自身与 evidence/*.log——MANIFEST 自身无法校验自己，
# 日志每次运行都会再生；其余全部入仓文件都在 MANIFEST 里。
# 日志：全部输出同时写进 evidence/selftest-setup-sh-20261126.log（原始 stdout + 退出码）。

main() {
  set -euo pipefail
  cd "$(dirname "$0")"
  mkdir -p evidence

  # ---- NODE：按版本号 ≥20 选 ----
  NODE=""
  for c in node nodejs; do
    if command -v "$c" >/dev/null 2>&1; then
      major=$("$c" -v | sed 's/^v//; s/\..*//')
      if [ "$major" -ge 20 ]; then NODE="$c"; break; fi
    fi
  done
  if [ -z "$NODE" ]; then
    echo "SETUP FAIL：找不到 Node ≥20（node/nodejs 均不可用或版本过低）" >&2
    exit 1
  fi
  echo "NODE=$NODE ($("$NODE" -v))"

  # ---- 安装依赖：优先 pnpm，失败回退 npm ci ----
  if command -v pnpm >/dev/null 2>&1 && pnpm install; then
    echo "安装：pnpm install 成功"
  else
    echo "安装：pnpm 不可用或失败，回退 npm ci"
    npm ci
    echo "安装：npm ci 成功"
  fi

  # ---- TEST_NODE：按“能解析 vitest”选，能跑测试的优先 ----
  TEST_NODE=""
  for c in "$NODE" node nodejs; do
    if command -v "$c" >/dev/null 2>&1; then
      if "$c" -e "require.resolve('vitest')" >/dev/null 2>&1; then TEST_NODE="$c"; break; fi
    fi
  done
  if [ -z "$TEST_NODE" ]; then
    echo "SETUP FAIL：找不到能解析 vitest 的 node——自测无法运行，拒绝跳过" >&2
    exit 1
  fi
  echo "TEST_NODE=$TEST_NODE ($("$TEST_NODE" -v)，可解析 vitest)"

  # ---- typecheck ----
  # 注意：node_modules/.bin/tsc 是 shell 包装脚本，不能直接用 node 执行；
  # 用 typescript 的真实 JS 入口 node_modules/typescript/bin/tsc。
  "$TEST_NODE" ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
  echo "typecheck OK"

  # ---- Vitest ----
  # 同理：.bin/vitest 是 shell 包装脚本，用真实 JS 入口 node_modules/vitest/vitest.mjs。
  "$TEST_NODE" ./node_modules/vitest/vitest.mjs run
  echo "vitest OK"

  # ---- gen:api 校验（重新生成并与已提交类型逐字节比对）----
  "$TEST_NODE" scripts/verify-gen-api.mjs
  echo "gen:api check OK"

  # ---- MANIFEST 核验 ----
  sha256sum -c MANIFEST
  echo "MANIFEST OK"

  echo "SETUP OK：安装、typecheck、Vitest、gen:api 校验、MANIFEST 核验全部通过。"
}

main "$@" 2>&1 | tee evidence/selftest-setup-sh-20261126.log
exit "${PIPESTATUS[0]}"
