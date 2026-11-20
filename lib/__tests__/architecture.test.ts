import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const LIB = path.resolve('lib');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Every module specifier in a source file (static imports + dynamic import()). */
function imports(src: string): string[] {
  const specs: string[] = [];
  const re = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) specs.push(m[1]);
  return specs;
}

const isAppImport = (spec: string) => {
  if (spec === '@/app' || spec.startsWith('@/app/')) return true;
  if (!spec.startsWith('.')) return false;
  return spec.split('/').includes('app');
};

describe('architecture rules', () => {
  it('no module under lib/ imports the app/ HTTP layer', () => {
    const offenders: string[] = [];
    for (const file of walk(LIB)) {
      for (const spec of imports(fs.readFileSync(file, 'utf8'))) {
        if (isAppImport(spec)) offenders.push(`${path.relative(process.cwd(), file)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the application layer never imports the HTTP routes', () => {
    const appDir = path.join(LIB, 'application');
    if (!fs.existsSync(appDir)) return;
    const offenders: string[] = [];
    for (const file of walk(appDir)) {
      for (const spec of imports(fs.readFileSync(file, 'utf8'))) {
        if (isAppImport(spec)) offenders.push(`${path.relative(process.cwd(), file)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
