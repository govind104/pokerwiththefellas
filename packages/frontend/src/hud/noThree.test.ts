import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The flat view must never load the lazy three.js chunk (Plan B spec §2.2, deviation 1): walk
// every relative import from src/hud and src/table and fail if the `three` package is reachable.
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => join(dir, f));
}

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

describe('HUD import guard', () => {
  it('nothing src/hud or src/table imports reaches the three package', () => {
    const stack = [...sourceFiles(join(SRC, 'hud')), ...sourceFiles(join(SRC, 'table'))];
    const seen = new Set<string>();
    const offenders: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/from\s+'([^']+)'/g)) {
        const spec = m[1];
        if (spec === 'three' || spec.startsWith('three/')) offenders.push(`${file} -> ${spec}`);
        else if (spec.startsWith('.')) {
          const next = resolveLocal(file, spec);
          if (next) stack.push(next);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });
});
