// 变异自证（#3291）：MAX_RETRIES 2 -> 1，依赖重试次数的测试必须变红，恢复后全绿。
//
// 做法（与 #3066 同一模式）：只改临时目录的源码副本，仓库内 src/config.ts
// 前后 SHA256 必须一致。三个相位：
//   A 相：原配置全量 vitest，应全过；
//   B 相：临时副本里 MAX_RETRIES = 2 改成 1，跑全量 vitest，应变红；
//   C 相：仓库内原配置全量 vitest，应全过。
// 日志：原始 stdout + 退出码写进 evidence/mutation-check-20261126.log（由调用方重定向）。

import { execSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const configPath = join(repoRoot, 'src', 'config.ts');

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function runVitest(cwd, label) {
  try {
    const out = execSync(join(repoRoot, 'node_modules', '.bin', 'vitest') + ' run --root ' + cwd, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(`--- ${label} ---`);
    console.log(out);
    console.log(`${label} exit=0`);
    return 0;
  } catch (err) {
    console.log(`--- ${label} ---`);
    console.log((err.stdout || '') + (err.stderr || ''));
    console.log(`${label} exit=${err.status}`);
    return err.status ?? 1;
  }
}

const beforeSha = sha256(configPath);
console.log(`config.ts SHA256（变异前）: ${beforeSha}`);

// A 相：原配置全量测试。
const exitA = runVitest(repoRoot, 'A 相：原配置');
if (exitA !== 0) {
  console.log('MUTATION CHECK: FAIL（A 相本应全过）');
  process.exit(1);
}

// B 相：临时副本里 MAX_RETRIES 2 -> 1。
const tmpDir = mkdtempSync(join(tmpdir(), 'mutation-3291-'));
try {
  for (const entry of ['src', 'tests', 'vitest.config.ts', 'tsconfig.json', 'package.json', 'examples']) {
    cpSync(join(repoRoot, entry), join(tmpDir, entry), { recursive: true });
  }
  symlinkSync(join(repoRoot, 'node_modules'), join(tmpDir, 'node_modules'), 'dir');
  const tmpConfig = join(tmpDir, 'src', 'config.ts');
  const text = readFileSync(tmpConfig, 'utf8');
  if (!text.includes('export const MAX_RETRIES = 2;')) {
    console.log('MUTATION CHECK: FAIL（临时副本里找不到 MAX_RETRIES = 2）');
    process.exit(1);
  }
  writeFileSync(tmpConfig, text.replace('export const MAX_RETRIES = 2;', 'export const MAX_RETRIES = 1;'));
  console.log('变异：临时副本 MAX_RETRIES 2 -> 1（只改临时副本）');
  const exitB = runVitest(tmpDir, 'B 相：变异配置（MAX_RETRIES=1）');
  if (exitB === 0) {
    console.log('MUTATION CHECK: FAIL（B 相本应变红，却全过了——测试对重试次数不敏感）');
    process.exit(1);
  }
  console.log('B 相已变红，符合预期。');
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

// C 相：恢复原配置，全量测试；仓库内 config.ts SHA256 必须与变异前一致。
const afterSha = sha256(configPath);
console.log(`config.ts SHA256（变异后）: ${afterSha}`);
if (afterSha !== beforeSha) {
  console.log('MUTATION CHECK: FAIL（仓库内 config.ts 被改动过）');
  process.exit(1);
}
const exitC = runVitest(repoRoot, 'C 相：恢复原配置');
if (exitC !== 0) {
  console.log('MUTATION CHECK: FAIL（C 相本应全过）');
  process.exit(1);
}

console.log('MUTATION CHECK: PASS');
