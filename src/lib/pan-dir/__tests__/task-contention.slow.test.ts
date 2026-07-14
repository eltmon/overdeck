/** @slow Real multi-process contention coverage; excluded from the default Vitest run. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

let root = '';
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

function runClaim(projectPath: string, itemId: string, writerId: string): Promise<number> {
  const modulePath = resolve(import.meta.dirname, '../task-door.ts');
  const script = `import { applyTaskStatusChange } from ${JSON.stringify(modulePath)}; applyTaskStatusChange({name:'contention',path:${JSON.stringify(projectPath)}},'LOCK-100',{type:'claim',itemId:${JSON.stringify(itemId)},writerId:${JSON.stringify(writerId)}}).then(()=>process.exit(0),()=>process.exit(1));`;
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '--eval', script], {
      env: { ...process.env, OVERDECK_HOME: join(projectPath, '.overdeck-home') }, stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('exit', code => resolveExit(code ?? 1));
  });
}

function makeProject(itemIds: string[]): string {
  root = mkdtempSync(join(tmpdir(), 'task-contention-'));
  const specs = join(root, '.pan', 'specs');
  mkdirSync(specs, { recursive: true });
  writeFileSync(join(specs, '2026-07-14-LOCK-100-contention.vbrief.json'), JSON.stringify({
    status: 'active', vBRIEFInfo: { version: '1', created: new Date().toISOString() },
    plan: { id: 'LOCK-100', title: 'Contention', status: 'active', items: itemIds.map(id => ({ id, title: id, status: 'pending' })), edges: [] },
  }));
  return root;
}

describe('@slow task-door multi-process contention', () => {
  it('allows exactly one of eight processes to claim the same item', async () => {
    const project = makeProject(['wi-1']);
    const exits = await Promise.all(Array.from({ length: 8 }, (_, index) => runClaim(project, 'wi-1', `writer-${index}`)));
    expect(exits.filter(code => code === 0)).toHaveLength(1);
  }, 20_000);

  it('preserves parallel mutations to different items', async () => {
    const ids = Array.from({ length: 8 }, (_, index) => `wi-${index + 1}`);
    const project = makeProject(ids);
    expect(await Promise.all(ids.map((id, index) => runClaim(project, id, `writer-${index}`)))).toEqual(Array(8).fill(0));
  }, 20_000);
});
