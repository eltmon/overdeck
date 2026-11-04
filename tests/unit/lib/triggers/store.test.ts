/**
 * PAN-4648 W-1: the trigger store — hash-only URL secrets, 0600 file mode,
 * public projection, input validation, generated GitHub signing secrets, and
 * removal.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createTrigger,
  hashUrlSecret,
  listPublicTriggers,
  listTriggers,
  removeTrigger,
  setTriggerInbox,
  setTriggerSigningSecret,
  toPublicTrigger,
  triggersPath,
} from '../../../../src/lib/triggers/store.js';

let home: string;
const originalHome = process.env.OVERDECK_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4648-triggers-'));
  process.env.OVERDECK_HOME = home;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('trigger store (PAN-4648)', () => {
  it('returns a 64-hex URL secret, stores only its SHA-256, and never writes the secret', async () => {
    const created = await createTrigger({ name: 'ci-failures', target: { kind: 'conversation', conversation: '20261101-0001' } });

    expect(created.urlSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(created.trigger.id).toMatch(/^trg_[0-9a-f]{12}$/);
    expect(created.hookPath).toBe(`/hooks/${created.trigger.id}/${created.urlSecret}`);
    const [stored] = await listTriggers();
    expect(stored.secretHash).toBe(createHash('sha256').update(created.urlSecret).digest('hex'));
    expect(stored.secretHash).toBe(hashUrlSecret(created.urlSecret));

    const raw = await readFile(triggersPath(), 'utf8');
    expect(raw).not.toContain(created.urlSecret);
    expect(JSON.parse(raw)).toMatchObject({ v: 1, triggers: [{ id: created.trigger.id }] });
  });

  it('writes the file with mode 0600 and the public view hides both secrets', async () => {
    const created = await createTrigger({
      name: 'payments',
      target: { kind: 'project', projectKey: 'overdeck' },
      template: 'Look at this payment event.',
      verify: 'stripe',
      signingSecret: 'whsec_abcdefgh',
    });

    expect((await stat(triggersPath())).mode & 0o777).toBe(0o600);
    expect(created.trigger).not.toHaveProperty('secretHash');
    expect(created.trigger).not.toHaveProperty('signingSecret');
    expect(created.trigger.signingSecretSet).toBe(true);

    const [record] = await listTriggers();
    const publicView = toPublicTrigger(record);
    expect(publicView).not.toHaveProperty('secretHash');
    expect(publicView).not.toHaveProperty('signingSecret');
    expect(publicView.signingSecretSet).toBe(true);
    expect(await listPublicTriggers()).toEqual([publicView]);
  });

  it('rejects an invalid name, a long template, a project without a template, and a whitespace secret', async () => {
    const conversation = { kind: 'conversation', conversation: '20261101-0001' } as const;
    await expect(createTrigger({ name: 'bad/name', target: conversation })).rejects.toThrow(/name/);
    await expect(createTrigger({ name: 'x'.repeat(65), target: conversation })).rejects.toThrow(/name/);
    await expect(createTrigger({ name: 'long', target: conversation, template: 'a'.repeat(2_001) })).rejects.toThrow(/2000/);
    await expect(createTrigger({ name: 'proj', target: { kind: 'project', projectKey: 'overdeck' } })).rejects.toThrow(/template/);
    await expect(createTrigger({ name: 'ws', target: conversation, verify: 'github', signingSecret: 'has space here' })).rejects.toThrow(
      /whitespace/,
    );
    expect(await listTriggers()).toEqual([]);
  });

  it('generates and stores a GitHub signing secret, then removal drops the record', async () => {
    const created = await createTrigger({ name: 'gh', target: { kind: 'conversation', conversation: '20261101-0002' }, verify: 'github' });

    expect(created.generatedSigningSecret).toMatch(/^[0-9a-f]{64}$/);
    const [stored] = await listTriggers();
    expect(stored.signingSecret).toBe(created.generatedSigningSecret);
    expect(created.trigger.signingSecretSet).toBe(true);

    expect(await removeTrigger(created.trigger.id)).toBe(true);
    expect((await listTriggers()).find((record) => record.id === created.trigger.id)).toBeUndefined();
    expect(await removeTrigger(created.trigger.id)).toBe(false);
  });

  it('stores no signing secret for a Stripe trigger created without one', async () => {
    const created = await createTrigger({ name: 'st', target: { kind: 'conversation', conversation: '20261101-0003' }, verify: 'stripe' });
    expect(created.generatedSigningSecret).toBeNull();
    expect(created.trigger.signingSecretSet).toBe(false);
  });

  it('sets a signing secret with the same validation, and returns null for an unknown id', async () => {
    const created = await createTrigger({ name: 'st', target: { kind: 'conversation', conversation: '20261101-0003' }, verify: 'stripe' });

    await expect(setTriggerSigningSecret(created.trigger.id, 'short')).rejects.toThrow(/8-256/);
    const updated = await setTriggerSigningSecret(created.trigger.id, 'whsec_rolled_secret');
    expect(updated?.signingSecretSet).toBe(true);
    expect((await listTriggers())[0].signingSecret).toBe('whsec_rolled_secret');
    expect(await setTriggerSigningSecret('trg_000000000000', 'whsec_rolled_secret')).toBeNull();
  });

  it('serializes concurrent creates so no record is lost', async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => createTrigger({ name: `t${i}`, target: { kind: 'conversation', conversation: '20261101-0001' } })),
    );
    expect(await listTriggers()).toHaveLength(5);
  });

  it('throws naming the path when the file does not parse', async () => {
    await writeFile(triggersPath(), 'not json', 'utf8');
    await expect(listTriggers()).rejects.toThrow(`Cannot read trigger store ${triggersPath()}`);
  });
});

describe('trigger inbox (PAN-2356 WI-20)', () => {
  it('parses a triggers.json written before the inbox field existed', async () => {
    const legacy = {
      v: 1,
      triggers: [{
        id: 'trg_0123456789ab',
        name: 'old',
        secretHash: '0'.repeat(64),
        target: { kind: 'conversation', conversation: '20261101-0001' },
        template: null,
        verify: 'none',
        signingSecret: null,
        createdAt: '2026-10-01T00:00:00.000Z',
      }],
    };
    await writeFile(triggersPath(), JSON.stringify(legacy));
    const [record] = await listTriggers();
    expect(record?.id).toBe('trg_0123456789ab');
    expect(record?.inbox).toBeUndefined();
  });

  it('attaches and clears an inbox, and the public record shows it', async () => {
    const created = await createTrigger({ name: 'held', target: { kind: 'conversation', conversation: '20261101-0001' } });
    const inbox = { id: 'ib_0123456789abcdef', createdAt: '2026-11-01T00:00:00.000Z' };
    expect(await setTriggerInbox(created.trigger.id, inbox)).toMatchObject({ id: created.trigger.id, inbox });
    expect((await listTriggers())[0]?.inbox).toEqual(inbox);
    await setTriggerInbox(created.trigger.id, null);
    expect((await listTriggers())[0]?.inbox).toBeNull();
    expect(await setTriggerInbox('trg_ffffffffffff', inbox)).toBeNull();
  });

  it('refuses a store whose inbox handle is malformed', async () => {
    const created = await createTrigger({ name: 'held', target: { kind: 'conversation', conversation: '20261101-0001' } });
    const file = JSON.parse(await readFile(triggersPath(), 'utf8')) as { triggers: Array<Record<string, unknown>> };
    file.triggers[0]!.inbox = { id: 'not-an-inbox', createdAt: 'x' };
    await writeFile(triggersPath(), JSON.stringify(file));
    await expect(listTriggers()).rejects.toThrow('unexpected shape');
    expect(created.trigger.id).toMatch(/^trg_/);
  });
});
