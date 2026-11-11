import { describe, expect, it, vi } from 'vitest';
import { mergeDiskResources } from '../merge-disk.js';
import type { DiskResourcesConfig } from '../schema-disk.js';

const DEFAULTS: DiskResourcesConfig = { diskWarnGb: 5, diskCriticalGb: 2 };

function resolved(): DiskResourcesConfig {
  return { ...DEFAULTS };
}

describe('mergeDiskResources', () => {
  it('keeps the defaults when no disk_* keys are set', () => {
    const result = resolved();
    mergeDiskResources({}, result, DEFAULTS);
    expect(result).toEqual({ diskWarnGb: 5, diskCriticalGb: 2 });
  });

  it('applies a valid override', () => {
    const result = resolved();
    mergeDiskResources({ disk_warn_gb: 8, disk_critical_gb: 3 }, result, DEFAULTS);
    expect(result).toEqual({ diskWarnGb: 8, diskCriticalGb: 3 });
  });

  it('ignores invalid values and preserves the earlier value', () => {
    const result: DiskResourcesConfig = { diskWarnGb: 9, diskCriticalGb: 4 };
    mergeDiskResources({ disk_warn_gb: 0, disk_critical_gb: -1 }, result, DEFAULTS);
    expect(result).toEqual({ diskWarnGb: 9, diskCriticalGb: 4 });

    const result2: DiskResourcesConfig = { diskWarnGb: 9, diskCriticalGb: 4 };
    mergeDiskResources(
      { disk_warn_gb: '5' as unknown as number, disk_critical_gb: NaN },
      result2,
      DEFAULTS,
    );
    expect(result2).toEqual({ diskWarnGb: 9, diskCriticalGb: 4 });

    const result3: DiskResourcesConfig = { diskWarnGb: 9, diskCriticalGb: 4 };
    mergeDiskResources({ disk_warn_gb: 2000 }, result3, DEFAULTS);
    expect(result3).toEqual({ diskWarnGb: 9, diskCriticalGb: 4 });
  });

  it('resets an inverted pair to the defaults and warns exactly once', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const resultA = resolved();
      mergeDiskResources({ disk_warn_gb: 2, disk_critical_gb: 3 }, resultA, DEFAULTS);
      expect(resultA).toEqual({ diskWarnGb: 5, diskCriticalGb: 2 });

      const resultB = resolved();
      mergeDiskResources({ disk_warn_gb: 2, disk_critical_gb: 3 }, resultB, DEFAULTS);
      expect(resultB).toEqual({ diskWarnGb: 5, diskCriticalGb: 2 });

      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
