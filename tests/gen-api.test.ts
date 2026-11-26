// gen:api 生成物测试（#3291 任务书：pnpm gen:api 从 OpenAPI JSON 生成类型）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

describe('gen:api 生成物', () => {
  it('examples/openapi.json 是合法的 OpenAPI 3 文档，含 3 个操作', () => {
    const spec = JSON.parse(readFileSync(join(repoRoot, 'examples', 'openapi.json'), 'utf8'));
    expect(spec.openapi.startsWith('3.')).toBe(true);
    expect(Object.keys(spec.paths)).toEqual([
      '/api/leads',
      '/api/spaces',
      '/api/spaces/{spaceId}',
    ]);
    expect(spec.paths['/api/spaces'].get.operationId).toBe('listSpaces');
    expect(spec.paths['/api/leads'].post.operationId).toBe('createLead');
  });

  it('src/generated/api.ts 已生成，含 paths 与示例 schema 类型', () => {
    const generated = readFileSync(join(repoRoot, 'src', 'generated', 'api.ts'), 'utf8');
    expect(generated).toContain('paths');
    expect(generated).toContain('Space');
    expect(generated).toContain('Lead');
    expect(generated).toContain('listSpaces');
    expect(generated).toContain('createLead');
  });
});
