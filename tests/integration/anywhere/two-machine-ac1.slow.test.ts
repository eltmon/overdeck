/**
 * Overdeck Anywhere AC-1 on one host (PAN-4774 WI-4, FR-1, FR-2, NFR-3, NFR-4).
 *
 * Two peer dashboards (A and B) link both ways through a byte-logging proxy in
 * front of B, list each other's conversations, open a large transcript within
 * the NFR-9 budget, remote-control a live fake-claude conversation on B from A,
 * pull it to A with an uncommitted change, and show B refuses new turns after.
 * The proxy capture proves only the secure channel crossed the pairing route.
 *
 * The pull adopts into A's own clone because A runs with
 * OVERDECK_TEST_ADOPT_SKIP_SAVED_CWD=1 (PAN-4774 D-2): on one host B's saved
 * cwd always exists for A too. The live Fly run (AC-5) covers two filesystems.
 *
 * Needs a built tree and tmux; both are preconditions that fail, never skip.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pollUntil, startPair, type Machine, type Pair } from '../../helpers/anywhere/two-dashboards.js';

const execFileAsync = promisify(execFile);
/** NFR-9: an open moves at most 1 MiB + 64 KiB. */
const OPEN_BUDGET_BYTES = 1_114_112;
const ORIGIN = 'https://github.com/smoke/repo.git';
const UNCOMMITTED = 'pulled with the conversation (PAN-4774)\n';

interface MachineLink {
  environmentId: string;
  state: string;
  currentRoute?: string | null;
}

interface MachinesList {
  self: { environmentId: string };
  links: MachineLink[];
}

interface ConversationRow {
  name: string;
}

let pair: Pair;
let envA = '';
let envB = '';
let liveName = '';

function claudeProjectDir(fakeHome: string, cwd: string): string {
  return join(fakeHome, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9-]/g, '-'));
}

/** A Claude-shaped transcript of `turns` user/assistant pairs, each turn padded with `fillerBytes` of text. */
function transcript(sessionId: string, cwd: string, turns: number, fillerBytes: number): string {
  const filler = 'lorem ipsum dolor sit amet '.repeat(Math.ceil(fillerBytes / 27)).slice(0, fillerBytes);
  const lines: string[] = [];
  for (let turn = 0; turn < turns; turn++) {
    const timestamp = new Date(Date.UTC(2026, 10, 1, 10, 0, turn)).toISOString();
    lines.push(JSON.stringify({ type: 'user', uuid: randomUUID(), sessionId, cwd, timestamp, message: { role: 'user', content: `turn ${turn}: ${filler}` } }));
    lines.push(JSON.stringify({ type: 'assistant', uuid: randomUUID(), sessionId, cwd, timestamp, message: { role: 'assistant', content: [{ type: 'text', text: `answer ${turn}: ${filler}` }] } }));
  }
  return `${lines.join('\n')}\n`;
}

/** A conversation row on `machine` whose Claude transcript is `body`; returns the transcript size. */
function seedConversation(machine: Machine, environmentId: string, name: string, turns: number, fillerBytes: number): number {
  const cwd = join(machine.home, `project-${name}`);
  mkdirSync(cwd, { recursive: true });
  const sessionId = randomUUID();
  const dir = claudeProjectDir(machine.fakeHome, cwd);
  mkdirSync(dir, { recursive: true });
  const body = transcript(sessionId, cwd, turns, fillerBytes);
  writeFileSync(join(dir, `${sessionId}.jsonl`), body);
  const db = new DatabaseSync(join(machine.home, 'overdeck.db'));
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const id = randomUUID();
    db.prepare(`INSERT INTO conversations (id, name, cwd, harness, title, created_at, tmux_session, status, origin, vault_owner_label, environment_id, ended_at)
      VALUES (?, ?, ?, 'claude-code', ?, ?, ?, 'active', 'local', NULL, ?, NULL)`)
      .run(id, name, cwd, `AC-1 ${name}`, Date.now(), `conv-${name}`, environmentId);
    db.prepare("INSERT INTO conversation_files (conversation_id, harness, locator, created_at) VALUES (?, 'claude-code', ?, ?)").run(id, sessionId, Date.now());
  } finally {
    db.close();
  }
  return Buffer.byteLength(body);
}

function rowCwd(machine: Machine, name: string): string | null {
  const db = new DatabaseSync(join(machine.home, 'overdeck.db'));
  try {
    const row = db.prepare('SELECT cwd FROM conversations WHERE name = ?').get(name) as { cwd: string } | undefined;
    return row?.cwd ?? null;
  } finally {
    db.close();
  }
}

function projectsYaml(path: string): string {
  return ['projects:', '  smoke:', '    name: smoke', `    path: ${path}`, '    github_repo: smoke/repo', ''].join('\n');
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', ['-c', 'user.email=ac1@overdeck.invalid', '-c', 'user.name=ac1', '-c', 'commit.gpgsign=false', ...args], { cwd });
}

async function lists(name: 'a' | 'b', conversation: string): Promise<boolean> {
  const listed = await pair.api(name, 'GET', '/api/conversations');
  return Array.isArray(listed.json) && (listed.json as ConversationRow[]).some((row) => row.name === conversation);
}

function linkTo(list: MachinesList, environmentId: string): MachineLink | null {
  return list.links.find((link) => link.environmentId === environmentId) ?? null;
}

describe('Overdeck Anywhere AC-1 on two local dashboards (PAN-4774)', () => {
  beforeAll(async () => {
    pair = await startPair();
  }, 120_000);

  afterAll(async () => {
    await pair?.stop();
  }, 30_000);

  it('links both ways', async () => {
    const pairing = await pair.cliJson<{ url: string }>('b', ['pair', '--url', `http://127.0.0.1:${pair.proxy.port}`, '--json']);
    await pair.cliJson('a', ['machines', 'link', pairing.url, '--allow-loopback', '--json']);
    const linkedAt = Date.now();
    const [listA, listB] = await Promise.all([
      pair.cliJson<MachinesList>('a', ['machines', 'list', '--json']),
      pair.cliJson<MachinesList>('b', ['machines', 'list', '--json']),
    ]);
    envA = listA.self.environmentId;
    envB = listB.self.environmentId;
    await pollUntil('both machines online', 15_000 - (Date.now() - linkedAt), async () => {
      const [a, b] = await Promise.all([
        pair.cliJson<MachinesList>('a', ['machines', 'list', '--json']),
        pair.cliJson<MachinesList>('b', ['machines', 'list', '--json']),
      ]);
      const aToB = linkTo(a, envB);
      const bToA = linkTo(b, envA);
      if (aToB?.state === 'online' && bToA?.state === 'online') return { ok: true, value: true };
      return { ok: false, detail: `A->B ${aToB?.state ?? 'missing'}, B->A ${bToA?.state ?? 'missing'}` };
    });
  }, 60_000);

  it('lists each other\'s conversations within 15 s', async () => {
    seedConversation(pair.b, envB, 'ac1-on-b', 2, 64);
    seedConversation(pair.a, envA, 'ac1-on-a', 2, 64);
    const onA = `@${envB}/ac1-on-b`;
    const onB = `@${envA}/ac1-on-a`;
    await pollUntil(`A lists ${onA} and B lists ${onB}`, 15_000, async () => {
      const [a, b] = await Promise.all([lists('a', onA), lists('b', onB)]);
      return a && b ? { ok: true, value: true } : { ok: false, detail: `A ${a ? 'lists' : 'misses'} B's row, B ${b ? 'lists' : 'misses'} A's row` };
    });
  }, 45_000);

  it('opens within the NFR-9 budget', async () => {
    const bytes = seedConversation(pair.b, envB, 'ac1-big', 300, 8_000);
    expect(bytes).toBeGreaterThan(2 * 1024 * 1024);
    const linked = `@${envB}/ac1-big`;
    await pollUntil(`A lists ${linked}`, 30_000, async () => ((await lists('a', linked)) ? { ok: true, value: true } : { ok: false }));
    const before = pair.proxy.fromB.bytes;
    const opened = await pair.api('a', 'GET', `/api/conversations/${encodeURIComponent(linked)}/messages`);
    const moved = pair.proxy.fromB.bytes - before;
    expect(opened.status).toBe(200);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(OPEN_BUDGET_BYTES);
  }, 60_000);

  it('remote-controls a live conversation', async () => {
    const live = join(pair.b.home, 'live');
    mkdirSync(live, { recursive: true });
    writeFileSync(join(live, 'README.md'), 'ac1\n');
    await git(live, 'init', '-q', '-b', 'main');
    await git(live, 'remote', 'add', 'origin', ORIGIN);
    await git(live, 'add', 'README.md');
    await git(live, 'commit', '-q', '-m', 'readme');
    writeFileSync(join(pair.b.home, 'projects.yaml'), projectsYaml(live));

    const created = await pair.api('b', 'POST', '/api/conversations', { message: 'start', cwd: live, projectKey: 'smoke' });
    expect(created.status, JSON.stringify(created.json)).toBeLessThan(300);
    liveName = (created.json as ConversationRow).name;
    const method = await pair.api('b', 'POST', `/api/conversations/${encodeURIComponent(liveName)}/delivery-method`, { deliveryMethod: 'tmux' });
    expect(method.status, JSON.stringify(method.json)).toBe(200);

    const linked = `@${envB}/${liveName}`;
    await pollUntil(`A lists ${linked}`, 30_000, async () => ((await lists('a', linked)) ? { ok: true, value: true } : { ok: false }));
    const sent = await pair.api('a', 'POST', `/api/conversations/${encodeURIComponent(linked)}/message`, { message: 'ping-4774', clientMessageId: 'ac1-1' });
    expect(sent.status, JSON.stringify(sent.json)).toBeLessThan(300);

    await pollUntil('the reply on A', 30_000, async () => {
      const logged = existsSync(pair.b.inputLog) && readFileSync(pair.b.inputLog, 'utf8').includes('ping-4774');
      const page = await pair.api('a', 'GET', `/api/conversations/${encodeURIComponent(linked)}/messages`);
      const replied = JSON.stringify(page.json).includes('fake-reply:ping-4774');
      return logged && replied ? { ok: true, value: true } : { ok: false, detail: `input logged ${logged}, reply on A ${replied} (status ${page.status})` };
    });
  }, 120_000);

  it('pulls it with uncommitted changes', async () => {
    const checkoutB = join(pair.b.home, 'live');
    const checkoutA = join(pair.a.home, 'live');
    await execFileAsync('git', ['clone', '-q', checkoutB, checkoutA]);
    await git(checkoutA, 'remote', 'set-url', 'origin', ORIGIN);
    writeFileSync(join(pair.a.home, 'projects.yaml'), projectsYaml(checkoutA));
    writeFileSync(join(checkoutB, 'uncommitted.txt'), UNCOMMITTED);

    const job = await pair.cliJson<{ state: string; conversation?: { name: string } }>('a', ['conv', 'pull', `@${envB}/${liveName}`, '--stop-turn', '--json'], 170_000);
    expect(job.state, JSON.stringify(job)).toBe('done');
    const pulledName = job.conversation?.name ?? '';
    expect(rowCwd(pair.a, pulledName)).toBe(checkoutA);
    expect(checkoutA).not.toBe(checkoutB);
    expect(readFileSync(join(checkoutA, 'uncommitted.txt'), 'utf8')).toBe(UNCOMMITTED);
  }, 180_000);

  it('the old owner refuses new turns', async () => {
    const direct = await pair.api('b', 'POST', `/api/conversations/${encodeURIComponent(liveName)}/message`, { message: 'still there?', clientMessageId: 'ac1-2' });
    expect(direct.status, JSON.stringify(direct.json)).toBe(409);
    expect(direct.json).toMatchObject({ code: 'conversation-released' });
    const through = await pair.api('a', 'POST', `/api/conversations/${encodeURIComponent(`@${envB}/${liveName}`)}/message`, { message: 'still there?', clientMessageId: 'ac1-3' });
    expect(through.status, JSON.stringify(through.json)).toBe(409);
    expect(through.json).toMatchObject({ code: 'conversation-released' });
  }, 30_000);

  it('nothing crossed in plaintext', () => {
    const bytes = Buffer.concat(pair.proxy.capture);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes[0]).toBe(0x00);
    expect(bytes.toString('latin1')).not.toContain('HTTP/1.1');
  }, 10_000);
});
