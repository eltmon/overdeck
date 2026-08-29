import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

export function writeRenderedGlobalContext(file: string, content: string): boolean {
  const existing = existsSync(file) ? readFileSync(file, 'utf-8') : '';
  if (content.trim() === existing.trim()) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${content.trim()}\n`, 'utf-8');
  return true;
}
