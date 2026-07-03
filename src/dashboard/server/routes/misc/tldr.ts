import { existsSync } from 'node:fs';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { isTldrEnabledSync } from '../../../../lib/config-yaml.js';
import { jsonResponse } from '../../http-helpers.js';

async function getIndexStats(
  rootPath: string,
  isMain: boolean,
): Promise<{ fileCount?: number; indexAge?: string; edgeCount?: number }> {
  const tldrPath = join(rootPath, '.tldr');
  const tldrExists = await access(tldrPath).then(() => true, () => false);
  if (!tldrExists) return {};
  try {
    let indexAge: string | undefined;
    const langPath = join(tldrPath, 'languages.json');
    const langContent = await readFile(langPath, 'utf-8').catch(() => null);
    if (langContent) {
      const langData = JSON.parse(langContent);
      if (langData.timestamp) {
        const ageMs = Date.now() - langData.timestamp * 1000;
        if (isMain) {
          const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
          indexAge = ageDays === 0 ? 'today' : `${ageDays}d ago`;
        } else {
          const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
          indexAge =
            ageHours === 0 ? 'now' : ageHours < 24 ? `${ageHours}h ago` : `${Math.floor(ageHours / 24)}d ago`;
        }
      }
    }
    if (!indexAge) {
      const stats = await stat(tldrPath);
      const ageMs = Date.now() - stats.mtimeMs;
      if (isMain) {
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        indexAge = ageDays === 0 ? 'today' : `${ageDays}d ago`;
      } else {
        const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
        indexAge =
          ageHours === 0 ? 'now' : ageHours < 24 ? `${ageHours}h ago` : `${Math.floor(ageHours / 24)}d ago`;
      }
    }

    let fileCount: number | undefined;
    let edgeCount: number | undefined;
    const cgPath = join(tldrPath, 'cache', 'call_graph.json');
    const cgContent = await readFile(cgPath, 'utf-8').catch(() => null);
    if (cgContent) {
      const cg = JSON.parse(cgContent);
      edgeCount = Array.isArray(cg.edges) ? cg.edges.length : undefined;
      if (Array.isArray(cg.edges)) {
        const files = new Set<string>();
        for (const e of cg.edges) {
          if (e.from_file) files.add(e.from_file);
          if (e.to_file) files.add(e.to_file);
        }
        fileCount = files.size;
      }
    }

    return { fileCount, indexAge, edgeCount };
  } catch (err) {
    console.error(`[getIndexStats] Error for ${rootPath}:`, err);
    return {};
  }
}

// ─── Route: GET /api/services/tldr/status ────────────────────────────────────

const getTldrStatusRoute = HttpRouter.add(
  'GET',
  '/api/services/tldr/status',
  Effect.promise(async () => {
    try {
      const { getTldrDaemonServiceSync } = await import('../../../../lib/tldr-daemon.js');
      const projectRoot = process.cwd();
      const venvPath = join(projectRoot, '.venv');

      const results: Array<{
        workspace: string;
        running: boolean;
        pid?: number;
        healthy: boolean;
        workspacePath: string;
        fileCount?: number;
        indexAge?: string;
        edgeCount?: number;
      }> = [];

      if (existsSync(venvPath)) {
        const service = getTldrDaemonServiceSync(projectRoot, venvPath);
        const status = await service.getStatus();
        const indexStats = getIndexStats(projectRoot, true);

        results.push({
          workspace: 'main',
          running: status.running,
          pid: status.pid,
          healthy: status.healthy,
          workspacePath: projectRoot,
          ...indexStats,
        });
      }

      const workspacesDir = join(projectRoot, 'workspaces');
      if (existsSync(workspacesDir)) {
        const workspaces = (await readdir(workspacesDir, { withFileTypes: true })).filter(
          d => d.isDirectory() && d.name.startsWith('feature-'),
        );

        for (const ws of workspaces) {
          const wsPath = join(workspacesDir, ws.name);
          const wsVenvPath = join(wsPath, '.venv');

          if (existsSync(wsVenvPath)) {
            const service = getTldrDaemonServiceSync(wsPath, wsVenvPath);
            const status = await service.getStatus();
            const indexStats = getIndexStats(wsPath, false);

            results.push({
              workspace: ws.name,
              running: status.running,
              pid: status.pid,
              healthy: status.healthy,
              workspacePath: wsPath,
              ...indexStats,
            });
          }
        }
      }

      return jsonResponse({ daemons: results });
    }    catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error getting TLDR status:', error);
      return jsonResponse({ error: msg }, { status: 500 });
      }}),
);

// ─── Route: POST /api/services/tldr/start ────────────────────────────────────

const postTldrStartRoute = HttpRouter.add(
  'POST',
  '/api/services/tldr/start',
  Effect.promise(async () => {
    try {
      const { getTldrDaemonServiceSync } = await import('../../../../lib/tldr-daemon.js');
      const projectRoot = process.cwd();
      const venvPath = join(projectRoot, '.venv');

      if (!existsSync(venvPath)) {
        return jsonResponse(
          { error: 'No .venv found in project root' },
          { status: 404 },
        );
      }

      const service = getTldrDaemonServiceSync(projectRoot, venvPath);
      await service.start();
      return jsonResponse({ success: true, message: 'TLDR daemon started' });
    }    catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error starting TLDR daemon:', error);
      return jsonResponse({ error: msg }, { status: 500 });
      }}),
);

// ─── Route: POST /api/services/tldr/stop ─────────────────────────────────────

const postTldrStopRoute = HttpRouter.add(
  'POST',
  '/api/services/tldr/stop',
  Effect.promise(async () => {
    try {
      const { getTldrDaemonServiceSync } = await import('../../../../lib/tldr-daemon.js');
      const projectRoot = process.cwd();
      const venvPath = join(projectRoot, '.venv');

      if (!existsSync(venvPath)) {
        return jsonResponse(
          { error: 'No .venv found in project root' },
          { status: 404 },
        );
      }

      const service = getTldrDaemonServiceSync(projectRoot, venvPath);
      await service.stop();
      return jsonResponse({ success: true, message: 'TLDR daemon stopped' });
    }    catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error stopping TLDR daemon:', error);
      return jsonResponse({ error: msg }, { status: 500 });
      }}),
);

// ─── Route: POST /api/services/tldr/reload ───────────────────────────────────
// Reconciles every TLDR index daemon (main + each workspaces/feature-*/.venv)
// to the current agents.tldr.enabled toggle: restart when enabled, stop when
// disabled. Read-interception already toggles live via the read hook — this only
// refreshes the daemon/index layer, so it never touches running agents.

const postTldrReloadRoute = HttpRouter.add(
  'POST',
  '/api/services/tldr/reload',
  Effect.promise(async () => {
    try {
      const { getTldrDaemonServiceSync } = await import('../../../../lib/tldr-daemon.js');
      const enabled = isTldrEnabledSync();
      const projectRoot = process.cwd();

      // Collect every workspace that has a .venv (main + feature-* worktrees).
      const targets: string[] = [];
      if (existsSync(join(projectRoot, '.venv'))) targets.push(projectRoot);

      const workspacesDir = join(projectRoot, 'workspaces');
      if (existsSync(workspacesDir)) {
        const workspaces = (await readdir(workspacesDir, { withFileTypes: true })).filter(
          d => d.isDirectory() && d.name.startsWith('feature-'),
        );
        for (const ws of workspaces) {
          const wsPath = join(workspacesDir, ws.name);
          if (existsSync(join(wsPath, '.venv'))) targets.push(wsPath);
        }
      }

      let restarted = 0;
      let stopped = 0;
      const errors: Array<{ workspace: string; error: string }> = [];

      for (const wsPath of targets) {
        try {
          const service = getTldrDaemonServiceSync(wsPath, join(wsPath, '.venv'));
          if (enabled) {
            await service.restart();
            restarted++;
          } else {
            await service.stop();
            stopped++;
          }
        } catch (error: unknown) {
          errors.push({
            workspace: wsPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return jsonResponse({
        success: errors.length === 0,
        enabled,
        targets: targets.length,
        restarted,
        stopped,
        errors,
      });
    }    catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error reloading TLDR daemons:', error);
      return jsonResponse({ error: msg }, { status: 500 });
      }}),
);

export const tldrRouteLayer = Layer.mergeAll(
  getTldrStatusRoute,
  postTldrStartRoute,
  postTldrStopRoute,
  postTldrReloadRoute,
);
