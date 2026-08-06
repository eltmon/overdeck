import { describe, it, expect, beforeEach } from 'vitest';
import { memoryFeedLevel, patrolMemoryPressure, __resetMemoryPressurePatrolState, MemoryFeedLevel } from '../../../../src/lib/cloister/memory-pressure-patrol.js';
import type { MemoryVerdict, MemoryPressureBand } from '../../../../src/lib/cloister/memory-governor.js';

const GIB = 1024 ** 3;

describe('memory-pressure-patrol', () => {
  beforeEach(() => {
    __resetMemoryPressurePatrolState();
  });

  describe('memoryFeedLevel', () => {
    it('returns "shedding" for hard band', () => {
      const level = memoryFeedLevel('hard', 10 * GIB, 12 * GIB);
      expect(level).toBe('shedding');
    });

    it('returns "holding" for soft band', () => {
      const level = memoryFeedLevel('soft', 10 * GIB, 12 * GIB);
      expect(level).toBe('holding');
    });

    it('returns "watch" for ok band below watch reserve', () => {
      const level = memoryFeedLevel('ok', 10 * GIB, 12 * GIB);
      expect(level).toBe('watch');
    });

    it('returns "ok" for ok band above watch reserve', () => {
      const level = memoryFeedLevel('ok', 15 * GIB, 12 * GIB);
      expect(level).toBe('ok');
    });
  });

  describe('patrolMemoryPressure', () => {
    it('emits a warn-level entry when crossing into watch level', async () => {
      const emitted: object[] = [];

      const mockVerdict: MemoryVerdict = {
        band: 'ok' as const,
        availableBytes: 10 * GIB,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        emit: (entry: object) => emitted.push(entry),
      };

      const actions = await patrolMemoryPressure(deps);

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        level: 'warn',
        source: 'cloister',
        link: '/resources',
      });
      expect((emitted[0] as any).message).toContain('watch reserve');
      expect((emitted[0] as any).message).toContain('10.0 GiB');
      expect(typeof (emitted[0] as any).details).toBe('string');
      expect(actions).toHaveLength(1);
    });

    it('emits nothing on second call with same watch level', async () => {
      const emitted: object[] = [];

      const mockVerdict: MemoryVerdict = {
        band: 'ok' as const,
        availableBytes: 10 * GIB,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        emit: (entry: object) => emitted.push(entry),
      };

      await patrolMemoryPressure(deps);
      expect(emitted).toHaveLength(1);

      emitted.length = 0;
      const actions = await patrolMemoryPressure(deps);

      expect(emitted).toHaveLength(0);
      expect(actions).toHaveLength(0);
    });

    it('emits a warn-level entry for soft band (admission hold)', async () => {
      const emitted: object[] = [];

      const mockVerdict: MemoryVerdict = {
        band: 'soft' as const,
        availableBytes: 7 * GIB,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        emit: (entry: object) => emitted.push(entry),
      };

      const actions = await patrolMemoryPressure(deps);

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        level: 'warn',
        source: 'cloister',
      });
      expect((emitted[0] as any).message).toContain('stopped admitting');
      expect((emitted[0] as any).message).toContain('recovery reserve');
      expect(actions).toHaveLength(1);
    });

    it('emits an error-level entry for hard band (shedding)', async () => {
      const emitted: object[] = [];

      const mockVerdict: MemoryVerdict = {
        band: 'hard' as const,
        availableBytes: 3 * GIB,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        emit: (entry: object) => emitted.push(entry),
      };

      const actions = await patrolMemoryPressure(deps);

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        level: 'error',
        source: 'cloister',
      });
      expect((emitted[0] as any).message).toContain('critical');
      expect(actions).toHaveLength(1);
    });

    it('emits an info-level entry when recovering from watch to ok', async () => {
      const emitted: object[] = [];

      const mockVerdict: MemoryVerdict = {
        band: 'ok' as const,
        availableBytes: 10 * GIB,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        emit: (entry: object) => emitted.push(entry),
      };

      // First call: enter watch
      await patrolMemoryPressure(deps);
      expect(emitted).toHaveLength(1);
      expect((emitted[0] as any).level).toBe('warn');

      // Second call: recover to ok
      emitted.length = 0;
      const recoverVerdict: MemoryVerdict = {
        band: 'ok' as const,
        availableBytes: 15 * GIB,
      };
      const recoverDeps = {
        ...deps,
        assess: async () => recoverVerdict,
      };
      const actions = await patrolMemoryPressure(recoverDeps);

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        level: 'info',
        source: 'cloister',
      });
      expect((emitted[0] as any).message).toContain('cleared');
      expect(actions).toHaveLength(1);
    });

    it('always returns a string-valued details field', async () => {
      const emitted: object[] = [];

      const mockVerdict: MemoryVerdict = {
        band: 'ok' as const,
        availableBytes: 10 * GIB,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        emit: (entry: object) => emitted.push(entry),
      };

      await patrolMemoryPressure(deps);

      expect(emitted).toHaveLength(1);
      const details = (emitted[0] as any).details;
      expect(typeof details).toBe('string');
      expect(details).toContain('MemAvailable');
      expect(details).toContain('Watch reserve');
    });
  });
});
