#!/usr/bin/env node
/**
 * PAN-4331 W4: turn windows-smoke results files into one markdown report.
 *
 *   node scripts/windows-smoke/summarize.mjs <results-dir> > table.md
 *
 * Reads every *.json under <results-dir> (the probe outputs, schema in
 * .pan/drafts/PAN-4331.md "Results JSON schema") and prints a header, a table
 * with one row per catalogue step and one column per env, and a Details
 * section with the verbatim evidence of every non-pass cell. No dependencies.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STEP_TITLES = {
  '1a': 'npx @overdeck/core@latest --version',
  '1b': 'npx @overdeck/core@latest vault list',
  '1c': 'serve starts, GET / → 200',
  '1d': 'browser open',
  '2a': 'dashboard GET APIs',
  '2b': 'POST /api/conversations',
  '3a': 'vault join',
  '3b': 'vault list --json',
  '3c': 'vault resume --no-launch',
  '3d': 'materialized transcript',
  '3e': 'Claude Code pickup (CP-2)',
  '3f': 'home resolution',
  '3g': 'vault resume (launch claude)',
  '4a': 'code snapshot applied',
  '4b': 'code content',
  '4c': 'git status after apply',
  '4d': 'line endings',
  '4e': 'exec bit',
  '4f': 'symlink',
  '5a': 'WSL2 available',
};

const ENV_ORDER = ['windows-pwsh', 'windows-gitbash', 'wsl2'];

/** Legs that exist to look behind a blocker; they rate no supported path. */
const DIAGNOSTIC_ENVS = {
  'windows-pwsh-autocrlf-false':
    'diagnostic: windows-pwsh with `git config --global core.autocrlf false`, to see what breaks behind the step 3a blocker',
};
const STATUSES = new Set(['pass', 'fail', 'partial', 'not-run']);

function escapeCell(text) {
  return String(text).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

/** The first evidence line worth showing: npm's engine and deprecation warnings lead most outputs. */
function firstLine(evidence) {
  const lines = String(evidence ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => !/^npm (warn|notice)\b/i.test(line)) ?? lines[0] ?? '';
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function orderEnvs(results, expectedEnvs = []) {
  const envs = [...new Set([...expectedEnvs, ...results.map((r) => r.env)])];
  const known = ENV_ORDER.filter((env) => envs.includes(env));
  const others = envs.filter((env) => !ENV_ORDER.includes(env)).sort();
  return [...known, ...others];
}

function findStep(result, id) {
  return Array.isArray(result?.steps) ? result.steps.find((step) => step?.id === id) : undefined;
}

export function renderCell(step) {
  if (!step || !STATUSES.has(step.status)) return 'missing';
  switch (step.status) {
    case 'pass':
      return '✅ pass';
    case 'fail':
      // A probe's note names the failure more precisely than any evidence line.
      return `❌ fail: ${escapeCell(truncate(step.note || firstLine(step.evidence), 120))}`;
    case 'partial':
      return `⚠️ partial: ${escapeCell(step.note ?? '')}`;
    default:
      return '— not-run';
  }
}

function fence(text) {
  const longest = Math.max(2, ...[...String(text).matchAll(/`+/g)].map((m) => m[0].length));
  const marks = '`'.repeat(longest + 1);
  return `${marks}\n${text}\n${marks}`;
}

/**
 * Render the whole report. `results` is the parsed probe files; `options.runUrl`
 * names the workflow run, `options.problems` lists files that did not parse, and
 * `options.expectedEnvs` are columns to show even without a results file (every
 * cell then reads `missing`), so a probe that died cannot drop its column.
 */
export function renderTable(results, options = {}) {
  const envs = orderEnvs(results, options.expectedEnvs);
  const byEnv = new Map(results.map((r) => [r.env, r]));
  const out = ['# windows-smoke results', ''];
  if (options.runUrl) out.push(`Run: ${options.runUrl}`, '');
  const subjects = [...new Set(results.map((r) => r.subject).filter(Boolean))];
  if (subjects.length > 0) out.push(`Subject: ${subjects.join('; ')}`, '');
  for (const env of envs) {
    const r = byEnv.get(env);
    if (!r) {
      out.push(`- **${env}**: ⚠️ no results file (the probe did not finish or its upload is missing)`);
      continue;
    }
    const diagnostic = DIAGNOSTIC_ENVS[env] ? ` (${DIAGNOSTIC_ENVS[env]})` : '';
    out.push(`- **${env}**: ${r.runner ?? '?'}; node ${r.node ?? '?'}; ${r.git ?? '?'}${diagnostic}`);
  }
  for (const problem of options.problems ?? []) out.push(`- ⚠️ ${problem}`);
  out.push('');

  out.push(`| Step | ${envs.join(' | ')} |`);
  out.push(`| --- |${envs.map(() => ' --- |').join('')}`);
  for (const [id, title] of Object.entries(STEP_TITLES)) {
    const cells = envs.map((env) => renderCell(findStep(byEnv.get(env), id)));
    out.push(`| ${id} ${escapeCell(title)} | ${cells.join(' | ')} |`);
  }

  const details = [];
  for (const [id, title] of Object.entries(STEP_TITLES)) {
    for (const env of envs) {
      const step = findStep(byEnv.get(env), id);
      if (!step || !STATUSES.has(step.status) || step.status === 'pass') continue;
      details.push(
        '<details>',
        `<summary>${id} ${title} · ${env} · ${step.status}</summary>`,
        '',
        `Command: \`${String(step.command ?? '').replace(/`/g, "'")}\``,
        '',
        `Exit code: ${step.exitCode ?? 'none'}${step.note ? ` · Note: ${step.note}` : ''}`,
        '',
        fence(String(step.evidence ?? '')),
        '',
        '</details>',
        '',
      );
    }
  }
  if (details.length > 0) out.push('', '## Details', '', ...details);
  return `${out.join('\n').trimEnd()}\n`;
}

function listJsonFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...listJsonFiles(path));
    else if (name.endsWith('.json')) files.push(path);
  }
  return files;
}

export function loadResults(dir) {
  const results = [];
  const problems = [];
  for (const path of listJsonFiles(dir)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (typeof parsed?.env !== 'string') throw new Error('no "env" field');
      results.push(parsed);
    } catch (error) {
      problems.push(`${path}: not a results file (${error.message})`);
    }
  }
  return { results, problems };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node scripts/windows-smoke/summarize.mjs <results-dir>');
    process.exit(2);
  }
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  const runUrl = GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID
    ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
    : undefined;
  const { results, problems } = loadResults(dir);
  // The workflow always runs these legs; WSL1 replaces WSL2 under the PRD's CP-3 fallback.
  const wsl = results.some((r) => r.env === 'wsl1-fallback') ? 'wsl1-fallback' : 'wsl2';
  const expectedEnvs = ['windows-pwsh', 'windows-gitbash', wsl];
  process.stdout.write(renderTable(results, { runUrl, problems, expectedEnvs }));
}
