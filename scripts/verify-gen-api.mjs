// gen:api 校验：用 openapi-typescript 从示例 schema 重新生成类型，
// 与仓内已提交的 src/generated/api.ts 逐字节比对；不一致就报错退出。
// 供 setup.sh 与 CI 调用；生成物本身由 `pnpm gen:api` 写出。

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const tmpDir = mkdtempSync(join(tmpdir(), 'gen-api-check-'));

try {
  execFileSync(
    join(repoRoot, 'node_modules', '.bin', 'openapi-typescript'),
    [join(repoRoot, 'examples', 'openapi.json'), '-o', join(tmpDir, 'api.ts')],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  const fresh = readFileSync(join(tmpDir, 'api.ts'), 'utf8');
  const committed = readFileSync(join(repoRoot, 'src', 'generated', 'api.ts'), 'utf8');
  if (fresh !== committed) {
    console.error('gen:api check FAILED：重新生成的类型与 src/generated/api.ts 不一致。');
    console.error('请跑 `pnpm gen:api` 后重新提交。');
    process.exitCode = 1;
  } else {
    console.log('gen:api check OK：重新生成的类型与 src/generated/api.ts 一致。');
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
