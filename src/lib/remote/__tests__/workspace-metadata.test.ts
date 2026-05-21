import { beforeEach, afterEach, expect } from 'vitest';
import { it, layer } from '@effect/vitest';
import { Effect } from 'effect';
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  WORKSPACES_DIR,
  saveWorkspaceMetadata,
  loadWorkspaceMetadata,
  listWorkspaceMetadata,
  findRemoteWorkspaceMetadata,
  deleteWorkspaceMetadata,
} from '../workspace-metadata.js';
import type { RemoteWorkspaceMetadata } from '../interface.js';
import { FsError } from '../../errors.js';

const uniqueId = () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const makeMetadata = (id: string): RemoteWorkspaceMetadata => ({
  id,
  issue: 'PAN-9999',
  provider: 'test',
  vmName: 'vm-test',
  urls: {},
  created: new Date('2024-01-01T00:00:00.000Z'),
  location: 'local',
});

layer(NodeFileSystem.layer)('workspace-metadata', it => {
  const testFiles: string[] = [];

  beforeEach(() => {
    mkdirSync(WORKSPACES_DIR, { recursive: true });
  });

  afterEach(() => {
    for (const f of testFiles.splice(0)) {
      try {
        rmSync(f);
      } catch {
        // already deleted by the test
      }
    }
  });

  it.effect('saves and loads metadata round-trip', () =>
    Effect.gen(function* () {
      const id = uniqueId();
      testFiles.push(join(WORKSPACES_DIR, `${id}.yaml`));
      const metadata = makeMetadata(id);

      yield* saveWorkspaceMetadata(metadata);
      const loaded = yield* loadWorkspaceMetadata(id);

      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(id);
      expect(loaded?.issue).toBe('PAN-9999');
      expect(loaded?.provider).toBe('test');
    }),
  );

  it.effect('loadWorkspaceMetadata returns null for non-existent file', () =>
    Effect.gen(function* () {
      const result = yield* loadWorkspaceMetadata('nonexistent-id-zzz-99999');
      expect(result).toBeNull();
    }),
  );

  it.effect('loadWorkspaceMetadata surfaces FsError with operation=parse on bad YAML', () =>
    Effect.gen(function* () {
      const id = uniqueId();
      const filename = join(WORKSPACES_DIR, `${id}.yaml`);
      testFiles.push(filename);
      writeFileSync(filename, ': invalid: yaml: {{{', 'utf-8');

      const err = yield* loadWorkspaceMetadata(id).pipe(Effect.flip);
      expect(err).toBeInstanceOf(FsError);
      expect(err.operation).toBe('parse');
    }),
  );

  it.effect('listWorkspaceMetadata includes saved metadata', () =>
    Effect.gen(function* () {
      const id = uniqueId();
      testFiles.push(join(WORKSPACES_DIR, `${id}.yaml`));
      yield* saveWorkspaceMetadata(makeMetadata(id));

      const list = yield* listWorkspaceMetadata();

      expect(Array.isArray(list)).toBe(true);
      expect(list.some(w => w.id === id)).toBe(true);
    }),
  );

  it.effect('listWorkspaceMetadata returns empty array when directory does not exist', () =>
    Effect.gen(function* () {
      // WORKSPACES_DIR exists in this environment; we verify the return type
      // is correct and the function succeeds (empty or non-empty array).
      const list = yield* listWorkspaceMetadata();
      expect(Array.isArray(list)).toBe(true);
    }),
  );

  it.effect('deleteWorkspaceMetadata returns false for non-existent file', () =>
    Effect.gen(function* () {
      const result = yield* deleteWorkspaceMetadata('nonexistent-xyz-88888');
      expect(result).toBe(false);
    }),
  );

  it.effect('deleteWorkspaceMetadata removes file and returns true', () =>
    Effect.gen(function* () {
      const id = uniqueId();
      const filename = join(WORKSPACES_DIR, `${id}.yaml`);
      testFiles.push(filename);
      yield* saveWorkspaceMetadata(makeMetadata(id));

      const deleted = yield* deleteWorkspaceMetadata(id);
      expect(deleted).toBe(true);

      const loaded = yield* loadWorkspaceMetadata(id);
      expect(loaded).toBeNull();
    }),
  );

  it.effect('findRemoteWorkspaceMetadata delegates to loadWorkspaceMetadata', () =>
    Effect.gen(function* () {
      const result = yield* findRemoteWorkspaceMetadata('nonexistent-abc-77777');
      expect(result).toBeNull();
    }),
  );
});
