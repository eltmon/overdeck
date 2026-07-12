import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DOLT_RUNTIME_NAMES = new Set([
  'dolt-server.pid',
  'dolt-server.lock',
  'dolt-server.port',
  'dolt-server.log',
]);

export function isDoltRuntimePath(path: string): boolean {
  const normalized = path.split(sep).join('/').replace(/^\.beads\//, '');
  const [first = ''] = normalized.split('/');
  const name = normalized.split('/').at(-1) ?? '';
  return first === 'dolt'
    || first === 'embeddeddolt'
    || first === 'backup'
    || DOLT_RUNTIME_NAMES.has(name)
    || name.endsWith('.dolt');
}

export function listLiveDoltLayout(beadsDir: string): string[] {
  if (!existsSync(beadsDir)) return [];
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const local = relative(beadsDir, absolute);
      if (isDoltRuntimePath(local)) {
        found.push(local.split(sep).join('/'));
        if (entry.isDirectory()) continue;
      }
      if (entry.isDirectory()) visit(absolute);
    }
  };
  visit(beadsDir);
  return found.sort();
}

export function detectLiveDoltLayout(beadsDir: string): boolean {
  return listLiveDoltLayout(beadsDir).length > 0;
}
