#!/usr/bin/env node
/**
 * Proportional cost recovery: for multi-issue sessions, splits costs
 * based on which issue was being discussed at each point in the conversation.
 *
 * Strategy: for each assistant response with usage, look at the surrounding
 * context (the human message before it and assistant message itself) to determine
 * which issue is being worked on at that moment.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { openNodeSqliteDatabase } from './sqlite.mjs';

const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects');
const DB_PATH = join(homedir(), '.panopticon', 'panopticon.db');

const PRICING = [
  { provider: 'anthropic', model: 'claude-opus-4.6', inputPer1k: 5e-3, outputPer1k: 0.025, cacheReadPer1k: 5e-4, cacheWrite5mPer1k: 625e-5 },
  { provider: 'anthropic', model: 'claude-opus-4-6', inputPer1k: 5e-3, outputPer1k: 0.025, cacheReadPer1k: 5e-4, cacheWrite5mPer1k: 625e-5 },
  { provider: 'anthropic', model: 'claude-opus-4-1', inputPer1k: 0.015, outputPer1k: 0.075, cacheReadPer1k: 15e-4, cacheWrite5mPer1k: 0.01875 },
  { provider: 'anthropic', model: 'claude-opus-4', inputPer1k: 0.015, outputPer1k: 0.075, cacheReadPer1k: 15e-4, cacheWrite5mPer1k: 0.01875 },
  { provider: 'anthropic', model: 'claude-sonnet-4.5', inputPer1k: 3e-3, outputPer1k: 0.015, cacheReadPer1k: 3e-4, cacheWrite5mPer1k: 375e-5 },
  { provider: 'anthropic', model: 'claude-sonnet-4-6', inputPer1k: 3e-3, outputPer1k: 0.015, cacheReadPer1k: 3e-4, cacheWrite5mPer1k: 375e-5 },
  { provider: 'anthropic', model: 'claude-sonnet-4', inputPer1k: 3e-3, outputPer1k: 0.015, cacheReadPer1k: 3e-4, cacheWrite5mPer1k: 375e-5 },
  { provider: 'anthropic', model: 'claude-haiku-4.5', inputPer1k: 1e-3, outputPer1k: 5e-3, cacheReadPer1k: 1e-4, cacheWrite5mPer1k: 125e-5 },
  { provider: 'anthropic', model: 'claude-haiku-4', inputPer1k: 1e-3, outputPer1k: 5e-3, cacheReadPer1k: 1e-4, cacheWrite5mPer1k: 125e-5 },
  { provider: 'anthropic', model: 'claude-haiku-3', inputPer1k: 25e-5, outputPer1k: 125e-5, cacheReadPer1k: 3e-5, cacheWrite5mPer1k: 3e-4 },
  { provider: 'custom', model: 'kimi-k2.5', inputPer1k: 6e-4, outputPer1k: 2e-3, cacheReadPer1k: 6e-5, cacheWrite5mPer1k: 75e-5 },
  { provider: 'custom', model: 'kimi-for-coding', inputPer1k: 6e-4, outputPer1k: 2e-3, cacheReadPer1k: 6e-5, cacheWrite5mPer1k: 75e-5 },
];

function getPricing(model) {
  return PRICING.find(p => model.startsWith(p.model)) || PRICING.find(p => model.includes(p.model)) || null;
}

function calculateCost(usage, pricing) {
  let cost = 0;
  let inputMul = 1, outputMul = 1;
  const totalInput = usage.input + (usage.cacheRead || 0) + (usage.cacheWrite || 0);
  if (pricing.model.includes('sonnet-4') && totalInput > 200000) { inputMul = 2; outputMul = 1.5; }
  cost += usage.input / 1000 * pricing.inputPer1k * inputMul;
  cost += usage.output / 1000 * pricing.outputPer1k * outputMul;
  if (usage.cacheRead && pricing.cacheReadPer1k) cost += usage.cacheRead / 1000 * pricing.cacheReadPer1k;
  if (usage.cacheWrite && pricing.cacheWrite5mPer1k) cost += usage.cacheWrite / 1000 * pricing.cacheWrite5mPer1k;
  return Math.round(cost * 1e6) / 1e6;
}

const ISSUE_RE = /\b(PAN|MIN|AUR|KRUX|CLI)-(\d+)\b/gi;

function extractIssues(text) {
  const counts = {};
  let match;
  const re = new RegExp(ISSUE_RE.source, 'gi');
  while ((match = re.exec(text)) !== null) {
    const id = `${match[1].toUpperCase()}-${match[2]}`;
    counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

function inferIssueFromPath(dirName) {
  const match = dirName.match(/(pan|min|aud|krux|cli)[-](\d+)/i);
  if (match) return `${match[1].toUpperCase()}-${match[2]}`;
  return null;
}

// Main
const db = openNodeSqliteDatabase(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

const insert = db.prepare(`
  INSERT OR IGNORE INTO cost_events (
    ts, agent_id, issue_id, session_type, provider, model,
    input, output, cache_read, cache_write, cost, request_id, source_file
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let totalInserted = 0;
let totalDuplicates = 0;
let totalUnattributed = 0;
const issueStats = {};

const projectDirs = readdirSync(CLAUDE_PROJECTS);

for (const dirName of projectDirs) {
  const projectDir = join(CLAUDE_PROJECTS, dirName);
  try { if (!statSync(projectDir).isDirectory()) continue; } catch { continue; }

  const pathIssueId = inferIssueFromPath(dirName);

  let transcripts;
  try {
    transcripts = readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => join(projectDir, f))
      .filter(f => { try { return statSync(f).isFile(); } catch { return false; } });
  } catch { continue; }

  for (const transcript of transcripts) {
    let content;
    try { content = readFileSync(transcript, 'utf-8'); } catch { continue; }
    const lines = content.split('\n').filter(l => l.trim());

    // Parse all entries
    const entries = [];
    for (const line of lines) {
      try { entries.push(JSON.parse(line)); } catch {}
    }

    // Track the "current issue context" as we walk through the conversation
    let currentIssue = pathIssueId || null;
    let lastHumanText = '';

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // Track human messages to build context window
      if (entry.type === 'human') {
        const text = JSON.stringify(entry.message || '');
        lastHumanText = text;
        // Update current issue if this human message mentions issues
        const issues = extractIssues(text);
        const sorted = Object.entries(issues).sort((a, b) => b[1] - a[1]);
        if (sorted.length > 0) {
          currentIssue = sorted[0][0];
        }
        continue;
      }

      if (entry.type !== 'assistant' || !entry.message?.usage) continue;

      const usage = entry.message.usage;
      const model = entry.message.model || 'claude-sonnet-4';
      const requestId = entry.requestId;
      if (!requestId) continue;

      const input = usage.input_tokens || 0;
      const output = usage.output_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;
      const cacheWrite = usage.cache_creation_input_tokens || 0;
      if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) continue;

      // Check this assistant message for issue mentions too
      const assistantText = JSON.stringify(entry.message?.content || '');
      const assistantIssues = extractIssues(assistantText);
      const combinedText = lastHumanText + ' ' + assistantText;
      const contextIssues = extractIssues(combinedText);
      const sorted = Object.entries(contextIssues).sort((a, b) => b[1] - a[1]);

      // Use the most-mentioned issue in the immediate context, falling back to running context
      let issueId = null;
      if (sorted.length > 0) {
        issueId = sorted[0][0];
        currentIssue = issueId; // Update running context
      } else {
        issueId = currentIssue;
      }

      if (!issueId) {
        totalUnattributed++;
        continue;
      }

      let provider = 'anthropic';
      if (model.includes('gpt')) provider = 'openai';
      else if (model.includes('gemini')) provider = 'google';
      else if (model.includes('kimi')) provider = 'custom';

      const pricing = getPricing(model);
      if (!pricing) continue;

      const cost = calculateCost({ input, output, cacheRead, cacheWrite }, pricing);
      const ts = entry.timestamp || new Date(statSync(transcript).mtime).toISOString();

      const result = insert.run(
        ts, 'recovered-proportional', issueId, 'interactive', provider, model,
        input, output, cacheRead, cacheWrite, cost, requestId, basename(transcript)
      );

      if (result.changes > 0) {
        totalInserted++;
        if (!issueStats[issueId]) issueStats[issueId] = { inserted: 0, cost: 0 };
        issueStats[issueId].inserted++;
        issueStats[issueId].cost += cost;
      } else {
        totalDuplicates++;
      }
    }
  }
}

db.close();

console.log(`\nProportional Cost Recovery Complete`);
console.log(`  NEW events inserted: ${totalInserted}`);
console.log(`  Duplicates skipped: ${totalDuplicates}`);
console.log(`  Unattributable: ${totalUnattributed}`);
console.log(`\nNewly recovered costs by issue:`);
const sorted = Object.entries(issueStats).sort((a, b) => b[1].cost - a[1].cost);
for (const [id, stats] of sorted) {
  console.log(`  ${id.padEnd(12)} ${String(stats.inserted).padStart(5)} events  $${stats.cost.toFixed(2)}`);
}
const totalCost = sorted.reduce((sum, [, s]) => sum + s.cost, 0);
console.log(`\n  TOTAL NEWLY RECOVERED: $${totalCost.toFixed(2)}`);
