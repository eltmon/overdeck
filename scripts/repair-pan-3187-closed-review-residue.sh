#!/usr/bin/env bash
#
# One-time PAN-3187 repair: close out tracker-closed issues whose durable
# review intent survived after their agents, sessions, and workspaces disappeared.
# Run only after building this workspace so close-out uses the matching DoD gate.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/dist/cli/index.js"
OVERDECK_HOME="${OVERDECK_HOME:-$HOME/.overdeck}"

NAMED_ISSUES=(
  PAN-2510 PAN-2230 PAN-2420 PAN-2375 PAN-2167 PAN-2407
  PAN-2257 PAN-2258 PAN-2248 PAN-1935 PAN-2150
)

if [[ ! -f "$CLI" ]]; then
  echo "error: $CLI is missing; run npm run build in $ROOT first" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
projects_json="$tmp_dir/projects.json"
node "$CLI" projects list --json > "$projects_json"

declare -A seen=()
repair_issues=()
discovered_issues=()
for issue_id in "${NAMED_ISSUES[@]}"; do
  seen["$issue_id"]=1
  repair_issues+=("$issue_id")
done

while IFS= read -r issue_id; do
  [[ -z "$issue_id" || -n "${seen[$issue_id]:-}" ]] && continue
  seen["$issue_id"]=1
  discovered_issues+=("$issue_id")
  repair_issues+=("$issue_id")
done < <(node --input-type=module - "$projects_json" "$OVERDECK_HOME/state" <<'NODE'
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , projectsPath, stateRoot] = process.argv;
const projects = JSON.parse(readFileSync(projectsPath, 'utf8'));
const discovered = new Set();

for (const [projectKey, project] of Object.entries(projects)) {
  const repo = typeof project.github_repo === 'string' ? project.github_repo : null;
  if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) continue;

  const recordsDir = join(stateRoot, projectKey, 'records');
  if (!existsSync(recordsDir)) continue;

  for (const entry of readdirSync(recordsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

    let record;
    try {
      record = JSON.parse(readFileSync(join(recordsDir, entry.name), 'utf8'));
    } catch (error) {
      console.error(`[repair-pan-3187] skipping unreadable record ${projectKey}/${entry.name}: ${error}`);
      continue;
    }
    const pipeline = record?.pipeline ?? {};
    if (pipeline.closedOut === true || record?.closeOut?.closedOut === true) continue;
    if (pipeline.reviewStatus !== 'pending' || !pipeline.reviewRequestedAt) continue;
    if (pipeline.reviewSpawnedAt &&
        Date.parse(pipeline.reviewRequestedAt) <= new Date(pipeline.reviewSpawnedAt).getTime()) continue;

    const issueId = String(record?.issueId ?? entry.name.replace(/\.json$/i, '')).toUpperCase();
    const match = issueId.match(/^[A-Z][A-Z0-9]*-(\d+)$/);
    if (!match) continue;

    try {
      const state = execFileSync('gh', [
        'issue', 'view', match[1], '--repo', repo, '--json', 'state', '--jq', '.state',
      ], { encoding: 'utf8', timeout: 10_000 }).trim().toUpperCase();
      if (state === 'CLOSED') discovered.add(issueId);
    } catch (error) {
      console.error(`[repair-pan-3187] tracker lookup failed for ${issueId} in ${repo}: ${error}`);
    }
  }
}

for (const issueId of [...discovered].sort()) console.log(issueId);
NODE
)

echo "Named PAN-3187 backlog (${#NAMED_ISSUES[@]}):"
printf '  %s\n' "${NAMED_ISSUES[@]}"
echo "Additional tracker-closed records (${#discovered_issues[@]}):"
if [[ ${#discovered_issues[@]} -eq 0 ]]; then
  echo "  (none)"
else
  printf '  %s\n' "${discovered_issues[@]}"
fi
echo "Repair list (${#repair_issues[@]}):"
printf '  %s\n' "${repair_issues[@]}"
echo

case "${OVERDECK_AGENT_ID:-}" in
  ""|conv-*|flywheel-*) ;;
  *)
    echo "error: pan close permits only an operator conversation or the flywheel orchestrator" >&2
    exit 1
    ;;
esac

declare -A outcomes=()
for issue_id in "${repair_issues[@]}"; do
  output_file="$tmp_dir/${issue_id}.log"
  set +e
  node "$CLI" close "$issue_id" --force --json > "$output_file" 2>&1
  close_rc=$?
  set -e

  outcomes["$issue_id"]="$(node --input-type=module - "$output_file" "$close_rc" <<'NODE'
import { readFileSync } from 'node:fs';

const [, , outputPath, exitCode] = process.argv;
const raw = readFileSync(outputPath, 'utf8');
const text = raw.replace(/\[[0-9;]*m/g, '');
const lines = text.split('\n');
let result = null;
for (let index = 0; index < lines.length; index += 1) {
  if (lines[index].trim() !== '{') continue;
  try {
    result = JSON.parse(lines.slice(index).join('\n'));
    break;
  } catch {
    // Keep looking for the JSON result after any preceding diagnostic output.
  }
}

if (result?.success === true) {
  console.log('closed-out');
  process.exit(0);
}

const misses = result?.dodGate?.rows?.filter((row) => row.status === 'miss' && !row.acceptedBy) ?? [];
if (misses.length > 0) {
  console.log(`refused: ${misses.map((row) => `row ${row.num} (${row.id})`).join(', ')}`);
  process.exit(0);
}

const failedStep = result?.steps?.find((step) => step.success === false && step.skipped !== true);
const rawError = failedStep?.error ?? lines.find((line) => /error|failed|not permitted/i.test(line)) ?? 'unknown close-out error';
const error = String(rawError).replace(/\s+/g, ' ').trim();
console.log(`error: ${error} (exit ${exitCode})`);
NODE
)"
done

echo "PAN-3187 close-out repair results:"
printf '%-14s %s\n' "ISSUE" "RESULT"
printf '%-14s %s\n' "-------------" "------"
for issue_id in "${repair_issues[@]}"; do
  printf '%-14s %s\n' "$issue_id" "${outcomes[$issue_id]}"
done

exit 0
