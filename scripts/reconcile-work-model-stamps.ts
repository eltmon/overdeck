#!/usr/bin/env bun
/**
 * reconcile-work-model-stamps.ts (PAN-3857, decision D5)
 *
 * Lists every issue record carrying a `workModel` stamp. Nearly all of these
 * stamps were written by the pre-fix spawn chain: the dashboard forwarded the
 * resolved role DEFAULT as `--model`, `pan start` treated it as explicit, and
 * `applyStartPolicyOptions` persisted it as a durable per-issue override the
 * operator never chose (127 records at audit time, 104 of them the stale
 * former default `gpt-5.6-sol` — drafts/routing-audit-2026-09-17.md on
 * overdeck-state).
 *
 * Usage:
 *   bun scripts/reconcile-work-model-stamps.ts                 # dry run (default)
 *   bun scripts/reconcile-work-model-stamps.ts --only gpt-5.6-sol
 *   bun scripts/reconcile-work-model-stamps.ts --apply         # clears the listed stamps
 *
 * Dry run prints `project, issue, workModel, record path` for every stamped
 * record and writes nothing. `--apply` clears `workModel` on exactly the
 * records the dry run listed, through the canonical record write door
 * (updateIssueRecord — the same writer start-policy-overrides.ts uses); it
 * never edits record JSON directly. Discovery reads record files only to
 * enumerate issue ids; every read-back and write goes through the door.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { listProjectsSync, type ProjectConfig } from '../src/lib/projects.js';
import { resolveStateDomainPathSync } from '../src/lib/state-read-home.js';
import { updateIssueRecord } from '../src/lib/pan-dir/record-update.js';
import { readIssueRecordSync } from '../src/lib/pan-dir/record.js';

interface StampedRecord {
  projectKey: string;
  project: ProjectConfig;
  issueId: string;
  workModel: string;
  recordPath: string;
}

function parseArgs(argv: string[]): { apply: boolean; only?: string } {
  let apply = false;
  let only: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') apply = true;
    else if (arg === '--only') {
      only = argv[i + 1];
      if (!only) throw new Error('--only requires a model value');
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}. Usage: bun scripts/reconcile-work-model-stamps.ts [--only <model>] [--apply]`);
    }
  }
  return { apply, only };
}

/** Candidate record directories for a project (migrated state plane, legacy
 * project/infra `.pan/records`, and legacy workspace `.pan/records`). */
function recordDirsFor(projectKey: string, project: ProjectConfig): string[] {
  const dirs = new Set<string>();
  try {
    dirs.add(resolveStateDomainPathSync(project, 'records', projectKey));
  } catch {
    // Project without a resolvable state home — fall through to the legacy dirs.
  }
  dirs.add(join(project.path, '.pan', 'records'));
  const workspacesDir = join(project.path, 'workspaces');
  if (existsSync(workspacesDir)) {
    for (const entry of readdirSync(workspacesDir)) {
      dirs.add(join(workspacesDir, entry, '.pan', 'records'));
    }
  }
  return [...dirs];
}

function listStampedRecords(only: string | undefined): StampedRecord[] {
  const stamped = new Map<string, StampedRecord>();
  for (const { key, config } of listProjectsSync()) {
    for (const dir of recordDirsFor(key, config)) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        const issueId = file.replace(/\.json$/, '').toUpperCase();
        const dedupeKey = `${key}:${issueId}`;
        if (stamped.has(dedupeKey)) continue;
        let workModel: string | undefined;
        try {
          const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { workModel?: unknown };
          workModel = typeof parsed.workModel === 'string' && parsed.workModel.length > 0 ? parsed.workModel : undefined;
        } catch {
          continue; // unreadable record — not this script's job; the read door surfaces it elsewhere
        }
        if (!workModel) continue;
        if (only && workModel !== only) continue;
        stamped.set(dedupeKey, {
          projectKey: key,
          project: config,
          issueId,
          workModel,
          recordPath: join(dir, file),
        });
      }
    }
  }
  return [...stamped.values()].sort((a, b) => `${a.projectKey}:${a.issueId}`.localeCompare(`${b.projectKey}:${b.issueId}`));
}

async function main(): Promise<void> {
  const { apply, only } = parseArgs(process.argv.slice(2));
  const stamped = listStampedRecords(only);

  for (const entry of stamped) {
    console.log(`${entry.projectKey}\t${entry.issueId}\t${entry.workModel}\t${entry.recordPath}`);
  }

  const byModel = new Map<string, number>();
  for (const entry of stamped) byModel.set(entry.workModel, (byModel.get(entry.workModel) ?? 0) + 1);
  const breakdown = [...byModel.entries()].sort((a, b) => b[1] - a[1]).map(([model, count]) => `${model}: ${count}`).join(', ');
  console.log(`\n${stamped.length} record(s) with workModel set${only ? ` (filtered to --only ${only})` : ''}. By model: ${breakdown || '(none)'}`);

  if (!apply) {
    console.log('Dry run only — re-run with --apply to clear these stamps through the record write door.');
    return;
  }

  let cleared = 0;
  for (const entry of stamped) {
    // Re-check inside the door: the record may have changed since the scan, and
    // only the exact stamped model this run listed may be cleared.
    await updateIssueRecord(entry.project, entry.issueId, (record) => {
      if (record.workModel && (!only || record.workModel === only)) {
        delete record.workModel;
      }
    });
    const after = readIssueRecordSync(entry.project, entry.issueId);
    if (!after?.workModel) cleared += 1;
    console.log(`cleared ${entry.projectKey}:${entry.issueId} (was ${entry.workModel})`);
  }
  console.log(`\nCleared workModel on ${cleared}/${stamped.length} record(s).`);
}

await main();
