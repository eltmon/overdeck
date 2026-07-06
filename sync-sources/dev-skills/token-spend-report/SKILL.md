---
name: token-spend-report
description: Regenerate Overdeck's public token spend report from the post-rebrand cost archive
triggers:
  - token spend report
  - regenerate spend report
  - update cost report
  - rebuild token report
  - cost history report
allowed-tools:
  - Bash
  - Read
  - Edit
---

# Token Spend Report

Use this skill when regenerating `docs/token-spend-report/index.html`, the public
Overdeck token spend report published at
`https://eltmon.github.io/overdeck/token-spend-report/`.

## Non-Negotiables

- Use `~/.overdeck/costs/events.jsonl` as the single report data source.
- Sort events by `ts` before aggregating. Backfill can append older reconstructed
  events after newer rows.
- Run `pan cost backfill` first. Use dry-run first, then `pan cost backfill --write`
  when the dry-run summary is sane.
- Keep the per-harness coverage boundary from
  `docs/token-spend-report/coverage.json` visible in the report.
- Keep the archival note that the pre-rebrand era, Feb 2025 through Jun 2026
  with 734,117 calls and about $54k spend, was deliberately not imported.
- Do not combine with a legacy SQLite database or any pre-rebrand live cost file.
- Do not regenerate videos unless the user explicitly asks.

## Pre-Flight

Read the existing report before editing:

```bash
sed -n '1,220p' docs/token-spend-report/index.html
```

Check the current coverage file when present:

```bash
test -f docs/token-spend-report/coverage.json && cat docs/token-spend-report/coverage.json
```

Preserve the report's existing dark visual system and chart structure unless the
user asks for a redesign. In particular, keep the monthly cost chart as a bar
chart with `borderRadius: 6` and `borderSkipped: false`, and keep the subscription
comparison labels unchanged.

## Backfill First

Run the catch-up command before extracting report numbers:

```bash
pan cost backfill
pan cost backfill --write
```

The dry-run should print per-source sessions scanned, would-import/imported
events, duplicates skipped, errors, and earliest/latest event timestamps. Treat
non-zero errors or surprising coverage gaps as something to investigate before
regenerating the HTML.

## Extract Data

Aggregate from `~/.overdeck/costs/events.jsonl` only:

```bash
node <<'NODE'
const fs = require('fs');
const path = `${process.env.HOME}/.overdeck/costs/events.jsonl`;
const events = fs.readFileSync(path, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));

const total = events.reduce((acc, e) => {
  acc.cost += Number(e.cost || 0);
  acc.calls += 1;
  acc.tokens += Number(e.input || 0) + Number(e.output || 0)
    + Number(e.cacheRead || 0) + Number(e.cacheWrite || 0);
  return acc;
}, { cost: 0, calls: 0, tokens: 0 });

console.log(total);
NODE
```

For the report data object, compute:

- `models`: top 10 by cost, with token totals.
- `providers`: provider cost totals.
- `stages`: `sessionType` cost totals.
- `monthly`: `YYYY-MM` cost totals sorted chronologically.
- `issues`: top 15 by `issueId`, with cost, calls, and average cost per call.
- `dailyCosts`: `YYYY-MM-DD` cost totals sorted chronologically.

Fetch issue titles from the Overdeck repo when useful:

```bash
gh issue view <number> --repo eltmon/overdeck --json title --jq '.title'
```

Use descriptive placeholders for `UNKNOWN`, test issues, or non-GitHub IDs.

## Update HTML

Edit `docs/token-spend-report/index.html`:

- Update hero counters from the extracted totals.
- Replace the full `reportData` object, preserving the variable name.
- Preserve existing card and chart structure.
- Keep the coverage banner prominent and orange/warning-styled.
- Keep the archival note stating the pre-rebrand era was deliberately not imported.
- Do not claim continuity with the old $54k figure.

If updating `fileGrowth`, use true git tree snapshots, not per-commit churn:

```bash
git log --format="%ad %H" --date=short --reverse \
  | awk '{ last[$1]=$2 } END { for (d in last) print d, last[d] }' | sort \
  | while read -r day hash; do
      echo "{\"date\":\"$day\",\"files\":$(git ls-tree -r --name-only "$hash" | wc -l)}"
    done | paste -sd, - | sed 's/^/const fileGrowth = [/; s/$/];/'
```

Do not add a running-max smoothing pass. Repository file count is allowed to go
down when files are deleted.

## Verify

Run the report data parse check:

```bash
node -e "const html=require('fs').readFileSync('docs/token-spend-report/index.html','utf8');const m=html.match(/reportData\s*=\s*(\{[\s\S]*?\});/);JSON.parse(JSON.stringify(eval('('+m[1]+')')));console.log('reportData parses')"
```

Confirm the required honesty language is present:

```bash
grep -c "deliberately not imported\\|734,117\\|~/.overdeck/costs/events.jsonl" docs/token-spend-report/index.html
```

For visual verification, serve the repo and inspect the page with an isolated
browser profile:

```bash
python3 -m http.server 8765
```

Open `http://localhost:8765/docs/token-spend-report/`, check every chart, and
confirm there are no console errors.

## Publish

Do not publish manually. The GitHub Pages workflow in
`.github/workflows/pages.yml` publishes only `docs/token-spend-report/` after
merge to `main`.
