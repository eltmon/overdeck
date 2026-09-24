import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  Observability,
  ObservabilityRpcGroup,
  ReplayEventsError,
  ReplayEventsRpc,
  SubscribeDomainEventsRpc,
} from '../../../../src/lib/overdeck/observability.js';

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('overdeck Observability RPC surface', () => {



  it('declares the RPC group over snapshot, subscribe, and replay methods', () => {
    expect(ObservabilityRpcGroup).toBeDefined();
    expect(SubscribeDomainEventsRpc).toBeDefined();
    expect(ReplayEventsRpc).toBeDefined();
    expect(ReplayEventsRpc.errorSchema).toBe(ReplayEventsError);
  });
});
