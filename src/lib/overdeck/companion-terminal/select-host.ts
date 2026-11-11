/**
 * Companion terminal host chosen by the host terminal backend (PAN-5122 D6).
 *
 * The lifecycle needs one host, picked per call: Herdr when the host backend
 * answers `herdr`, the unchanged tmux host otherwise. The Herdr host module is
 * loaded with a lazy `import()` and memoized — `index.ts` is imported by
 * `conversation-runtime.ts`, `conversation-lifecycle.ts`, `agent-projection.ts`
 * and (lazily) `codex/app-server-host.ts`, and a static edge from here to
 * `herdr.js` risks a `lint:circular` cycle.
 */
import type { TerminalBackendName } from '../../terminal-backends/types.js';
import { hostTerminalBackendName } from '../../terminal-backends/select.js';
import { createTmuxCompanionHost, type CompanionTerminalHost } from './host.js';

export interface BackendCompanionHostDeps {
  readonly backendName: () => Promise<TerminalBackendName>;
  readonly tmux: () => CompanionTerminalHost;
  readonly herdr: () => Promise<CompanionTerminalHost>;
}

let memoizedHerdrHost: Promise<CompanionTerminalHost> | undefined;

async function defaultHerdr(): Promise<CompanionTerminalHost> {
  memoizedHerdrHost ??= import('./herdr-host.js').then(({ createHerdrCompanionHost }) => createHerdrCompanionHost());
  return memoizedHerdrHost;
}

export function createBackendCompanionHost(overrides: Partial<BackendCompanionHostDeps> = {}): CompanionTerminalHost {
  const backendName = overrides.backendName ?? hostTerminalBackendName;
  let memoizedTmuxHost: CompanionTerminalHost | undefined;
  const tmux = overrides.tmux ?? (() => (memoizedTmuxHost ??= createTmuxCompanionHost()));
  const herdr = overrides.herdr ?? defaultHerdr;

  const hostFor = async (): Promise<CompanionTerminalHost> => ((await backendName()) === 'herdr' ? await herdr() : tmux());

  return {
    async ownerStamp(ownerSession) {
      return (await hostFor()).ownerStamp(ownerSession);
    },
    async readGeneration(companionSession) {
      return (await hostFor()).readGeneration(companionSession);
    },
    async create(companionSession, spec) {
      return (await hostFor()).create(companionSession, spec);
    },
    async kill(companionSession) {
      return (await hostFor()).kill(companionSession);
    },
  };
}
