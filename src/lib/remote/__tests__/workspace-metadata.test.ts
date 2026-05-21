import { describe, expect } from 'vitest';
import { layer } from '@effect/vitest';
import { Effect, FileSystem } from 'effect';
import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { FsError } from '../../errors.js';
import {
  saveWorkspaceMetadata,
  loadWorkspaceMetadata,
  listWorkspaceMetadata,
  deleteWorkspaceMetadata,
  findRemoteWorkspaceMetadata,
  WORKSPACES_DIR,
} from '../workspace-metadata.js';
import type { RemoteWorkspaceMetadata } from '../interface.js';

const TEST_ID = 'test-pan-ws-meta-unit';
const BAD_YAML_ID = 'test-pan-ws-meta-bad-yaml';

const testMetadata: RemoteWorkspaceMetadata = {
  id: TEST_ID,
  issue: 'TEST-9999',
  provider: 'test',
  vmName: 'test-vm',
  urls: {},
  created: new Date('2026-01-01T00:00:00.000Z'),
  location: 'remote',
};

layer(NodeFileSystem.layer)('workspace-metadata', (it) => {
  describe('saveWorkspaceMetadata + loadWorkspaceMetadata round-trip', () => {
    it.effect('persists and retrieves metadata', () =>
      Effect.gen(function* () {
        yield* saveWorkspaceMetadata(testMetadata);
        const loaded = yield* loadWorkspaceMetadata(TEST_ID);
        expect(loaded).not.toBeNull();
        expect(loaded?.id).toBe(TEST_ID);
        expect(loaded?.issue).toBe('TEST-9999');
        expect(loaded?.provider).toBe('test');
        expect(loaded?.location).toBe('remote');
        yield* deleteWorkspaceMetadata(TEST_ID);
      }),
    );
  });

  describe('loadWorkspaceMetadata', () => {
    it.effect('returns null for a non-existent issue', () =>
      Effect.gen(function* () {
        const result = yield* loadWorkspaceMetadata('nonexistent-issue-id-that-will-never-exist');
        expect(result).toBeNull();
      }),
    );

    it.effect('surfaces FsError on malformed YAML', () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dirExists = yield* fs.exists(WORKSPACES_DIR);
        if (!dirExists) {
          yield* fs.makeDirectory(WORKSPACES_DIR, { recursive: true });
        }
        const badFile = join(WORKSPACES_DIR, `${BAD_YAML_ID}.yaml`);
        yield* Effect.tryPromise(() => writeFile(badFile, ': invalid: yaml: {{{', 'utf-8'));

        const result = yield* Effect.flip(loadWorkspaceMetadata(BAD_YAML_ID));
        expect(result._tag).toBe('FsError');
        expect((result as FsError).operation).toBe('parse');

        yield* fs.remove(badFile);
      }),
    );
  });

  describe('listWorkspaceMetadata', () => {
    it.effect('returns an array (empty when no matching files)', () =>
      Effect.gen(function* () {
        const workspaces = yield* listWorkspaceMetadata();
        expect(Array.isArray(workspaces)).toBe(true);
      }),
    );

    it.effect('includes a saved workspace in the list', () =>
      Effect.gen(function* () {
        yield* saveWorkspaceMetadata(testMetadata);
        const workspaces = yield* listWorkspaceMetadata();
        const found = workspaces.find(w => w.id === TEST_ID);
        expect(found).toBeDefined();
        yield* deleteWorkspaceMetadata(TEST_ID);
      }),
    );
  });

  describe('deleteWorkspaceMetadata', () => {
    it.effect('returns false for a non-existent issue', () =>
      Effect.gen(function* () {
        const deleted = yield* deleteWorkspaceMetadata('nonexistent-issue-id-that-will-never-exist');
        expect(deleted).toBe(false);
      }),
    );

    it.effect('returns true and removes the file', () =>
      Effect.gen(function* () {
        yield* saveWorkspaceMetadata(testMetadata);
        const deleted = yield* deleteWorkspaceMetadata(TEST_ID);
        expect(deleted).toBe(true);
        const loaded = yield* loadWorkspaceMetadata(TEST_ID);
        expect(loaded).toBeNull();
      }),
    );
  });

  describe('findRemoteWorkspaceMetadata', () => {
    it.effect('delegates to loadWorkspaceMetadata', () =>
      Effect.gen(function* () {
        yield* saveWorkspaceMetadata(testMetadata);
        const found = yield* findRemoteWorkspaceMetadata(TEST_ID);
        expect(found?.id).toBe(TEST_ID);
        yield* deleteWorkspaceMetadata(TEST_ID);
      }),
    );
  });
});
