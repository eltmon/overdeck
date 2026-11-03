import { afterEach, describe, expect, it, vi } from 'vitest';
import { MACHINE_TAG, PUT_CLIENT_SQL, roleOf, SCHEMA } from '../../../../services/connect/src/directory.ts';
import type { ConnectIdentity } from '../../../../services/connect/src/env.ts';
import { logFrame } from '../../../../services/connect/src/log.ts';

const IDENTITY: ConnectIdentity = { userId: 'u-1', githubId: 1, deviceId: 'd-1', plan: 'free', maxDevices: 3 };
const ENV = '00000000-0000-4000-8000-000000000001';
const CLIENT = '00000000-0000-4000-9000-000000000001';
const PUSH_COLUMNS = ['push_platform', 'push_token', 'aps_environment'];

describe('directory glue for phone clients (PAN-4829 WI-6)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the machine tag and reads a pre-PAN-4829 attachment as a machine', () => {
    expect(MACHINE_TAG).toBe('machine');
    expect(roleOf({ identity: IDENTITY, environmentId: ENV })).toBe('machine');
    expect(roleOf({ identity: IDENTITY, environmentId: null })).toBeNull();
    expect(roleOf({ identity: IDENTITY, environmentId: null, clientId: null })).toBeNull();
    expect(roleOf({ identity: IDENTITY, environmentId: null, clientId: CLIENT })).toBe('client');
  });

  it('creates the clients table with nullable push columns that the upsert never writes', () => {
    const create = SCHEMA.find((statement) => statement.includes('CREATE TABLE IF NOT EXISTS clients'));
    expect(create).toBeDefined();
    for (const column of PUSH_COLUMNS) {
      expect(create).toMatch(new RegExp(`${column} TEXT\\s*[,)]`));
      expect(PUT_CLIENT_SQL).not.toContain(column);
    }
  });

  it('logs the client id only when one is given', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line);
    });
    logFrame('hello-client', null, 'registered', CLIENT);
    logFrame('hello', ENV, 'registered');
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({ frame: 'hello-client', env: null, outcome: 'registered', client: CLIENT });
    expect(JSON.parse(lines[1] ?? '{}')).toEqual({ frame: 'hello', env: ENV, outcome: 'registered' });
  });
});
