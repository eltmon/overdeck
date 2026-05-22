import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  LinkManager,
  parseIssueRef,
  formatIssueRef,
} from '../../../src/lib/tracker/linking.js';

function isEffect(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  for (const key of Object.getOwnPropertyNames(v)) {
    if (key.startsWith('~effect/Effect/')) return true;
  }
  return false;
}
function wrap<T extends object>(t: T): any {
  return new Proxy(t, {
    get(target, prop) {
      const value = (target as any)[prop];
      if (typeof value !== 'function') return value;
      return (...args: any[]) => {
        const result = value.apply(target, args);
        if (isEffect(result)) {
          return Effect.runPromise(result as any);
        }
        return result;
      };
    },
  });
}

describe('parseIssueRef', () => {
  it('should parse GitHub-style refs', () => {
    expect(parseIssueRef('#42')).toEqual({ tracker: 'github', ref: '#42' });
    expect(parseIssueRef('#123')).toEqual({ tracker: 'github', ref: '#123' });
  });

  it('should parse explicit GitHub prefix', () => {
    expect(parseIssueRef('github#42')).toEqual({ tracker: 'github', ref: '#42' });
  });

  it('should parse explicit GitLab prefix', () => {
    expect(parseIssueRef('gitlab#15')).toEqual({ tracker: 'gitlab', ref: '#15' });
  });

  it('should parse Linear-style refs', () => {
    expect(parseIssueRef('MIN-630')).toEqual({ tracker: 'linear', ref: 'MIN-630' });
    expect(parseIssueRef('PAN-42')).toEqual({ tracker: 'linear', ref: 'PAN-42' });
  });

  it('should handle lowercase Linear refs', () => {
    expect(parseIssueRef('min-630')).toEqual({ tracker: 'linear', ref: 'MIN-630' });
  });

  it('should return null for invalid refs', () => {
    expect(parseIssueRef('invalid')).toBeNull();
    expect(parseIssueRef('123')).toBeNull();
    expect(parseIssueRef('')).toBeNull();
  });
});

describe('formatIssueRef', () => {
  it('should format GitHub refs with prefix', () => {
    expect(formatIssueRef('#42', 'github')).toBe('github#42');
    expect(formatIssueRef('42', 'github')).toBe('github#42');
  });

  it('should format GitLab refs with prefix', () => {
    expect(formatIssueRef('#15', 'gitlab')).toBe('gitlab#15');
  });

  it('should return Linear refs unchanged', () => {
    expect(formatIssueRef('MIN-630', 'linear')).toBe('MIN-630');
  });
});

describe('LinkManager', () => {
  let tempDir: string;
  let manager: LinkManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-link-test-'));
    manager = wrap(new LinkManager(join(tempDir, 'links.json')));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  describe('addLink', () => {
    it('should add a link between issues', async () => {
      const link = await Effect.runPromise(manager.addLink(
        { ref: 'MIN-630', tracker: 'linear' },
        { ref: '#42', tracker: 'github' },
        'related'
      ));

      expect(link.sourceIssueRef).toBe('MIN-630');
      expect(link.sourceTracker).toBe('linear');
      expect(link.targetIssueRef).toBe('#42');
      expect(link.targetTracker).toBe('github');
      expect(link.direction).toBe('related');
      expect(link.createdAt).toBeDefined();
    });

    it('should not duplicate existing links', async () => {
      await Effect.runPromise(manager.addLink(
        { ref: 'MIN-630', tracker: 'linear' },
        { ref: '#42', tracker: 'github' }
      ));
      await Effect.runPromise(manager.addLink(
        { ref: 'MIN-630', tracker: 'linear' },
        { ref: '#42', tracker: 'github' }
      ));

      const links = await Effect.runPromise(manager.getAllLinks());
      expect(links.length).toBe(1);
    });

    it('should update direction on existing link', async () => {
      await Effect.runPromise(manager.addLink(
        { ref: 'MIN-630', tracker: 'linear' },
        { ref: '#42', tracker: 'github' },
        'related'
      ));
      await Effect.runPromise(manager.addLink(
        { ref: 'MIN-630', tracker: 'linear' },
        { ref: '#42', tracker: 'github' },
        'blocks'
      ));

      const links = await Effect.runPromise(manager.getAllLinks());
      expect(links.length).toBe(1);
      expect(links[0].direction).toBe('blocks');
    });
  });

  describe('removeLink', () => {
    it('should remove an existing link', async () => {
      await Effect.runPromise(manager.addLink(
        { ref: 'MIN-630', tracker: 'linear' },
        { ref: '#42', tracker: 'github' }
      ));

      const removed = await Effect.runPromise(manager.removeLink(
        { ref: 'MIN-630', tracker: 'linear' },
        { ref: '#42', tracker: 'github' }
      ));

      (await Effect.runPromise(expect(removed))).toBe(true);
      expect((await Effect.runPromise(manager.getAllLinks())).length).toBe(0);
    });

    it('should return false for non-existent link', async () => {
      const removed = await Effect.runPromise(manager.removeLink(
        { ref: 'MIN-999', tracker: 'linear' },
        { ref: '#999', tracker: 'github' }
      ));

      (await Effect.runPromise(expect(removed))).toBe(false);
    });
  });

  describe('getLinkedIssues', () => {
    it('should find links where issue is source', async () => {
      await Effect.runPromise(manager.addLink(
        { ref: 'MIN-630', tracker: 'linear' },
        { ref: '#42', tracker: 'github' }
      ));

      const links = await Effect.runPromise(manager.getLinkedIssues('MIN-630', 'linear'));
      expect(links.length).toBe(1);
      expect(links[0].targetIssueRef).toBe('#42');
    });

    it('should find links where issue is target', async () => {
      await Effect.runPromise(manager.addLink(
        { ref: 'MIN-630', tracker: 'linear' },
        { ref: '#42', tracker: 'github' }
      ));

      const links = await Effect.runPromise(manager.getLinkedIssues('#42', 'github'));
      expect(links.length).toBe(1);
      expect(links[0].sourceIssueRef).toBe('MIN-630');
    });
  });

  describe('findLinkedIssue', () => {
    it('should find linked issue in another tracker', async () => {
      await Effect.runPromise(manager.addLink(
        { ref: 'MIN-630', tracker: 'linear' },
        { ref: '#42', tracker: 'github' }
      ));

      (await Effect.runPromise(expect(await manager.findLinkedIssue('MIN-630', 'linear', 'github'))))inear', 'github'))).toBe('#42');
      (await Effect.runPromise(expect(await manager.findLinkedIssue('#42', 'github', 'linear'))))ithub', 'linear'))).toBe('MIN-630');
    });

    it('should return null when no link exists', async () => {
      (await Effect.runPromise(expect(await manager.findLinkedIssue('MIN-999', 'linear', 'github'))))inear', 'github'))).toBeNull();
    });
  });

  describe('persistence', () => {
    it('should persist links across manager instances', async () => {
      await Effect.runPromise(manager.addLink(
        { ref: 'MIN-630', tracker: 'linear' },
        { ref: '#42', tracker: 'github' }
      ));

      // Create new manager instance
      const newManager: any = wrap(new LinkManager(join(tempDir, 'links.json')));
      const links = await newManager.getAllLinks();

      expect(links.length).toBe(1);
      expect(links[0].sourceIssueRef).toBe('MIN-630');
    });
  });
});
