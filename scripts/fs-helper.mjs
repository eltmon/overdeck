import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [verb, ...args] = process.argv.slice(2);

if (verb === 'rmrf') {
  for (const target of args) {
    rmSync(target, { recursive: true, force: true });
  }
} else if (verb === 'copy-ext') {
  const [ext, srcDir, dstDir] = args;
  if (!ext || !srcDir || !dstDir) {
    console.error('Usage: fs-helper.mjs copy-ext <.ext> <src-dir> <dst-dir>');
    process.exit(1);
  }
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(ext)) continue;
    cpSync(join(srcDir, entry.name), join(dstDir, entry.name));
  }
} else {
  console.error(`Unknown verb: ${verb}`);
  process.exit(1);
}
