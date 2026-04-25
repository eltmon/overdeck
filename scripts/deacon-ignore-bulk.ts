#!/usr/bin/env node
/**
 * Bulk-apply the operator deacon-ignore flag to every issue matching
 * --prefix + --states. Uses the running dashboard's public API — no direct
 * DB access — so it honors the same write path as the kanban "Pause" button.
 *
 * Usage:
 *   tsx scripts/deacon-ignore-bulk.ts --prefix MIN --states "in progress,in review"
 *   tsx scripts/deacon-ignore-bulk.ts --prefix MIN --states "in progress,in review" --unignore
 *   DASHBOARD_URL=http://localhost:3030 tsx scripts/deacon-ignore-bulk.ts ...
 *
 * Default states match both "in progress" and "in review" (case-insensitive).
 */

interface Issue {
  id?: string;
  identifier?: string;
  status?: string;
  state?: string;
  [key: string]: unknown;
}

function parseArgs(argv: string[]): { prefix: string; states: string[]; unignore: boolean; reason?: string } {
  let prefix = '';
  let statesRaw = 'in progress,in review';
  let unignore = false;
  let reason: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prefix') prefix = (argv[++i] ?? '').toUpperCase();
    else if (a === '--states') statesRaw = argv[++i] ?? statesRaw;
    else if (a === '--unignore') unignore = true;
    else if (a === '--reason') reason = argv[++i];
  }
  if (!prefix) {
    console.error('Usage: tsx scripts/deacon-ignore-bulk.ts --prefix MIN [--states "in progress,in review"] [--unignore] [--reason "text"]');
    process.exit(1);
  }
  const states = statesRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { prefix, states, unignore, reason };
}

async function main(): Promise<void> {
  const { prefix, states, unignore, reason } = parseArgs(process.argv.slice(2));
  const base = process.env.DASHBOARD_URL ?? 'http://localhost:3030';

  const issuesRes = await fetch(`${base}/api/issues?includeCompleted=false`);
  if (!issuesRes.ok) {
    console.error(`GET /api/issues failed: ${issuesRes.status} ${issuesRes.statusText}`);
    process.exit(2);
  }
  const issues = (await issuesRes.json()) as Issue[];

  const matching = issues.filter((iss) => {
    const id = (iss.identifier ?? '').toUpperCase();
    if (!id.startsWith(`${prefix}-`)) return false;
    const s = (iss.status ?? iss.state ?? '').toLowerCase();
    return states.some((needle) => s === needle || s.includes(needle));
  });

  console.log(
    `Found ${matching.length} ${prefix}- issue(s) in states [${states.join(', ')}] — ` +
    `${unignore ? 'clearing' : 'setting'} deaconIgnored.`
  );
  if (matching.length === 0) return;

  let ok = 0;
  let fail = 0;
  for (const iss of matching) {
    const id = iss.identifier!;
    try {
      const res = await fetch(`${base}/api/workspaces/${encodeURIComponent(id)}/deacon-ignore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ignored: !unignore, reason }),
      });
      if (res.ok) {
        ok++;
        console.log(`  ✓ ${id} (${iss.status ?? iss.state})`);
      } else {
        fail++;
        const body = await res.text().catch(() => '');
        console.error(`  ✗ ${id}: ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
      }
    } catch (err) {
      fail++;
      console.error(`  ✗ ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`Done: ${ok} ok, ${fail} failed.`);
  if (fail > 0) process.exit(3);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
