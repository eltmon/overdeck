/**
 * `pan doctor` Herdr rows (PAN-3956 W9, FR-8, D9).
 *
 * Rows: `Terminal backend`, `Herdr binary`, `Herdr server`, `Herdr config`,
 * and one `Herdr integration: <target>` per target Overdeck reports on. Under
 * an explicit tmux policy only the `Terminal backend` row is emitted. A Herdr
 * policy whose binary or session socket is missing is an `error` row, so
 * `pan doctor` exits 1.
 *
 * Every input is injectable (the doctor-inotify pattern); the defaults read
 * the live host without changing anything.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

import { parse as parseToml } from '@iarna/toml';

import { herdrConfigPath } from '../../lib/herdr-setup/config.js';
import { herdrInstallDir } from '../../lib/herdr-setup/binary.js';
import {
  HERDR_INTEGRATION_BINARY,
  HERDR_INTEGRATION_TARGETS,
  HERDR_PILOT_INTEGRATIONS,
  defaultReadKimiVersion,
  defaultResolveHarnessBinary,
  kimiVersionBlocker,
  readIntegrationStatus,
  type IntegrationStatusRow,
} from '../../lib/herdr-setup/integrations.js';
import { herdrPersistentUnitWanted, herdrUnitName } from '../../lib/herdr-setup/service.js';
import { readHerdrStatus, type HerdrStatus } from '../../lib/herdr-setup/status.js';
import {
  probeHerdrAvailability,
  selectTerminalBackend,
  type HerdrAvailability,
  type TerminalBackendConfig,
  type TerminalBackendSelection,
} from '../../lib/terminal-backends/select.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-inotify.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export interface HerdrDoctorDeps {
  selection: TerminalBackendSelection;
  probe: HerdrAvailability;
  /** `herdr status --json`, parsed; null when the binary is absent or cannot answer. */
  status: HerdrStatus | null;
  /** `~/.config/herdr/config.toml` text; null when the file is missing. */
  configText: string | null;
  configPath: string;
  integrationRows: readonly IntegrationStatusRow[];
  /** `~/.claude/settings.json` text; null when missing. */
  claudeSettingsText: string | null;
  systemdAvailable: boolean;
  unitActive: boolean;
  kimiVersion: string | null;
  /** Harness binary resolution for the pilot integrations. */
  resolveBinary: (name: string) => Promise<string | null>;
  pathEnv: string;
  home: string;
}

const FIX_INSTALL = 'Run: pan install';
const FIX_SYNC = 'Run: pan sync';

async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

async function defaultSelection(): Promise<TerminalBackendSelection> {
  let config: TerminalBackendConfig = {};
  try {
    const { loadConfigSync } = await import('../../lib/config-yaml.js');
    config = loadConfigSync().config as TerminalBackendConfig;
  } catch {
    // Unreadable config: env and the default decide.
  }
  return selectTerminalBackend(config);
}

async function loadDefaults(partial: Partial<HerdrDoctorDeps>): Promise<HerdrDoctorDeps> {
  const home = partial.home ?? homedir();
  const selection = partial.selection ?? (await defaultSelection());
  const probe = partial.probe ?? (await probeHerdrAvailability());
  const binary = probe.binary;
  const configPath = partial.configPath ?? herdrConfigPath({ homeDir: home });
  let systemdAvailable = partial.systemdAvailable;
  let unitActive = partial.unitActive;
  if (systemdAvailable === undefined || unitActive === undefined) {
    const systemd = await import('../../lib/systemd.js');
    systemdAvailable ??= await systemd.systemdUserAvailable();
    unitActive ??= systemdAvailable ? await systemd.isUserUnitActive(herdrUnitName(probe.session)) : false;
  }
  return {
    selection,
    probe,
    status: partial.status !== undefined ? partial.status : binary ? await readHerdrStatus(binary, probe.session) : null,
    configText: partial.configText !== undefined ? partial.configText : await readTextOrNull(configPath),
    configPath,
    integrationRows: partial.integrationRows ?? (binary ? await readIntegrationStatus(binary) : []),
    claudeSettingsText: partial.claudeSettingsText !== undefined
      ? partial.claudeSettingsText
      : await readTextOrNull(join(home, '.claude', 'settings.json')),
    systemdAvailable,
    unitActive,
    kimiVersion: partial.kimiVersion !== undefined ? partial.kimiVersion : await defaultReadKimiVersion(),
    resolveBinary: partial.resolveBinary ?? defaultResolveHarnessBinary,
    pathEnv: partial.pathEnv ?? process.env.PATH ?? '',
    home,
  };
}

function backendRow(deps: HerdrDoctorDeps): CheckResult {
  const { selection, probe } = deps;
  if (selection.backend !== 'herdr') {
    const via = selection.source === 'env' ? 'OVERDECK_TERMINAL_BACKEND' : 'config.yaml';
    return { name: 'Terminal backend', status: 'ok', message: `${selection.backend} (explicit via ${via})` };
  }
  if (!probe.available) {
    return {
      name: 'Terminal backend',
      status: 'error',
      message: `herdr selected but unavailable: ${probe.reason ?? 'unknown reason'}`,
      fix: FIX_INSTALL,
    };
  }
  return {
    name: 'Terminal backend',
    status: 'ok',
    message: `herdr (${selection.source}) — session ${probe.session}, socket ${probe.socket}`,
  };
}

function binaryRow(deps: HerdrDoctorDeps): CheckResult {
  const binary = deps.probe.binary;
  if (!binary) {
    return { name: 'Herdr binary', status: 'error', message: 'Not found', fix: FIX_INSTALL };
  }
  const version = deps.status?.client.version ?? 'version unknown';
  const channel = deps.status?.client.channel ?? 'unknown';
  const message = `${version} at ${binary} (channel ${channel})`;
  const installDir = resolve(herdrInstallDir(deps.home));
  const onPath = deps.pathEnv.split(delimiter).filter(Boolean).map((dir) => resolve(dir));
  if (resolve(dirname(binary)) === installDir && !onPath.includes(installDir)) {
    return { name: 'Herdr binary', status: 'warn', message: `${message}; ~/.local/bin is not on PATH`, fix: 'Add ~/.local/bin to PATH' };
  }
  if (deps.status && channel !== 'stable') {
    return { name: 'Herdr binary', status: 'warn', message, fix: FIX_SYNC };
  }
  return { name: 'Herdr binary', status: 'ok', message };
}

function serverRow(deps: HerdrDoctorDeps): CheckResult {
  const unit = herdrUnitName(deps.probe.session);
  const server = deps.status?.server;
  if (!server?.running) {
    return {
      name: 'Herdr server',
      status: 'error',
      message: `not running (session ${deps.probe.session}, socket ${deps.probe.socket})`,
      fix: deps.probe.binary ? FIX_SYNC : FIX_INSTALL,
    };
  }
  const base = `running ${server.version ?? 'unknown'}, protocol ${server.protocol ?? '?'}`;
  if (!server.endpointCompatible) {
    return {
      name: 'Herdr server',
      status: 'error',
      message: `${base}, NOT endpoint compatible with herdr ${deps.status?.client.version ?? 'client'}`,
      fix: `Restart at a quiet moment: systemctl --user restart ${unit} (closes every agent pane)`,
    };
  }
  const unitNote = deps.unitActive ? `, unit ${unit} active` : '';
  const message = `${base}, endpoint compatible${unitNote}`;
  if (server.restartNeeded || server.serverBinaryStale) {
    return {
      name: 'Herdr server',
      status: 'warn',
      message: `${message}; server runs a stale binary (restart_needed)`,
      fix: `Restart at a quiet moment: systemctl --user restart ${unit} (closes every agent pane)`,
    };
  }
  // Only the default home (or an opted-in one) gets a unit; `pan sync` never
  // installs one for a throwaway home, so do not ask for it here.
  if (deps.systemdAvailable && !deps.unitActive && herdrPersistentUnitWanted(deps.probe.session)) {
    return { name: 'Herdr server', status: 'warn', message: `${message}; ${unit} is not active`, fix: FIX_SYNC };
  }
  return { name: 'Herdr server', status: 'ok', message };
}

function configRow(deps: HerdrDoctorDeps): CheckResult {
  const where = deps.configPath.startsWith(deps.home) ? `~${deps.configPath.slice(deps.home.length)}` : deps.configPath;
  if (deps.configText === null) {
    return { name: 'Herdr config', status: 'error', message: `${where} is missing (resume_agents_on_restore defaults to true)`, fix: FIX_SYNC };
  }
  let value: unknown;
  try {
    value = (parseToml(deps.configText) as { session?: Record<string, unknown> }).session?.resume_agents_on_restore;
  } catch (error) {
    return {
      name: 'Herdr config',
      status: 'error',
      message: `${where} does not parse: ${error instanceof Error ? error.message : String(error)}`,
      fix: FIX_SYNC,
    };
  }
  if (value === false) {
    return { name: 'Herdr config', status: 'ok', message: `resume_agents_on_restore = false (${where})` };
  }
  return {
    name: 'Herdr config',
    status: 'error',
    message: `resume_agents_on_restore is ${value === undefined ? 'unset (defaults to true)' : String(value)} in ${where}`
      + ' — a Herdr restart would relaunch paused and stopped agents',
    fix: FIX_SYNC,
  };
}

/** True when Overdeck's own `SessionStart` hook is registered in Claude settings. */
export function hasOverdeckSessionStartHook(settingsText: string | null): boolean {
  if (!settingsText) return false;
  try {
    const settings = JSON.parse(settingsText) as {
      hooks?: { SessionStart?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    return (settings.hooks?.SessionStart ?? []).some((entry) =>
      (entry.hooks ?? []).some((hook) => typeof hook.command === 'string' && /[/\\]session-start-hook$/.test(hook.command)));
  } catch {
    return false;
  }
}

async function integrationRow(
  target: (typeof HERDR_INTEGRATION_TARGETS)[number],
  deps: HerdrDoctorDeps,
): Promise<CheckResult> {
  const name = `Herdr integration: ${target}`;
  const row = deps.integrationRows.find((candidate) => candidate.target === target);
  const pilot = HERDR_PILOT_INTEGRATIONS.includes(target);

  // Unlisted (or `herdr integration status` unreadable): `pan sync` skips such
  // a target too, so naming it as the fix would never converge. Warn, no fix.
  if (!row) {
    const why = deps.integrationRows.length === 0
      ? '`herdr integration status` gave no readable output'
      : 'not listed by `herdr integration status`';
    return pilot
      ? { name, status: 'warn', message: `status unknown: ${why}` }
      : { name, status: 'ok', message: `status unknown: ${why} (not managed by Overdeck)` };
  }

  const state = row.state;
  const detail = `${row.detail}${row.path ? ` (${row.path})` : ''}`;

  if (state === 'unknown') {
    return { name, status: 'warn', message: `unrecognized status: ${detail}` };
  }

  if (!pilot) {
    if (state === 'not-installed') {
      return { name, status: 'ok', message: 'not installed (not managed by Overdeck — session-identity only)' };
    }
    if (target === 'claude' && !hasOverdeckSessionStartHook(deps.claudeSettingsText)) {
      return {
        name,
        status: 'warn',
        message: `${detail}; Overdeck's SessionStart hook is missing from ~/.claude/settings.json`,
        fix: FIX_SYNC,
      };
    }
    return { name, status: 'ok', message: `${detail} (not managed by Overdeck)` };
  }

  if (state === 'installed') return { name, status: 'ok', message: detail };
  if (state === 'outdated' || state === 'needs-repair') return { name, status: 'warn', message: detail, fix: FIX_SYNC };

  const binaryName = HERDR_INTEGRATION_BINARY[target];
  if (!(await deps.resolveBinary(binaryName))) {
    return { name, status: 'ok', message: `not installed (${binaryName} not on PATH)` };
  }
  if (target === 'kimi') {
    const blocker = kimiVersionBlocker(deps.kimiVersion);
    if (blocker) return { name, status: 'warn', message: `not installed (${blocker})` };
  }
  return { name, status: 'error', message: `not installed (${binaryName} is installed)`, fix: FIX_SYNC };
}

export async function checkHerdr(partial: Partial<HerdrDoctorDeps> = {}): Promise<CheckResult[]> {
  const selection = partial.selection ?? (await defaultSelection());
  if (selection.backend !== 'herdr') {
    return [backendRow({ ...(partial as HerdrDoctorDeps), selection })];
  }
  const deps = await loadDefaults({ ...partial, selection });
  const rows: CheckResult[] = [backendRow(deps), binaryRow(deps)];
  if (!deps.probe.binary) return rows;
  rows.push(serverRow(deps), configRow(deps));
  for (const target of HERDR_INTEGRATION_TARGETS) rows.push(await integrationRow(target, deps));
  return rows;
}
