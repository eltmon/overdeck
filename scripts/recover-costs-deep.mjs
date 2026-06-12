#!/usr/bin/env node
/**
 * Deep cost recovery: scans ALL Claude transcripts, including non-workspace ones.
 * For transcripts not in a workspace dir, infers issue ID from conversation content.
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

// Issue ID pattern: PAN-123, MIN-456, KRUX-1, CLI-1, AUR-1, etc.
const ISSUE_RE = /\b(PAN|MIN|AUR|KRUX|CLI)-(\d+)\b/gi;

function inferIssueFromPath(dirName) {
  const match = dirName.match(/(pan|min|aud|krux|cli)[-](\d+)/i);
  if (match) return `${match[1].toUpperCase()}-${match[2]}`;
  return null;
}

/**
 * Infer the primary issue from transcript content by counting mentions.
 * Only considers user and assistant messages, not system/tool content.
 */
function inferIssueFromContent(lines) {
  const counts = {};
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      // Only look at human and assistant messages for issue mentions
      if (entry.type !== 'human' && entry.type !== 'assistant') continue;
      const text = JSON.stringify(entry.message || '');
      let match;
      const re = new RegExp(ISSUE_RE.source, 'gi');
      while ((match = re.exec(text)) !== null) {
        const id = `${match[1].toUpperCase()}-${match[2]}`;
        counts[id] = (counts[id] || 0) + 1;
      }
    } catch {}
  }

  // Return the most-mentioned issue (if any has 2+ mentions)
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0 && sorted[0][1] >= 2) {
    return sorted[0][0];
  }
  return null;
}

function findTranscriptFiles(dir) {
  const files = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith('.jsonl')) {
        const full = join(dir, entry);
        try { if (statSync(full).isFile()) files.push(full); } catch {}
      }
    }
  } catch {}
  return files;
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

  // Try to get issue from path first
  const pathIssueId = inferIssueFromPath(dirName);

  const transcripts = findTranscriptFiles(projectDir);
  if (transcripts.length === 0) continue;

  for (const transcript of transcripts) {
    let content;
    try { content = readFileSync(transcript, 'utf-8'); } catch { continue; }
    const lines = content.split('\n');

    // Determine issue ID: path first, then content inference
    let issueId = pathIssueId;
    if (!issueId) {
      issueId = inferIssueFromContent(lines);
    }

    if (!issueId) {
      // Count usage events we're skipping
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'assistant' && entry.message?.usage) {
            const u = entry.message.usage;
            if ((u.input_tokens || 0) + (u.output_tokens || 0) > 0) totalUnattributed++;
          }
        } catch {}
      }
      continue;
    }

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
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

        let provider = 'anthropic';
        if (model.includes('gpt')) provider = 'openai';
        else if (model.includes('gemini')) provider = 'google';
        else if (model.includes('kimi')) provider = 'custom';

        const pricing = getPricing(model);
        if (!pricing) continue;

        const cost = calculateCost({ input, output, cacheRead, cacheWrite }, pricing);
        const ts = entry.timestamp || new Date(statSync(transcript).mtime).toISOString();

        const result = insert.run(
          ts, 'recovered-deep', issueId, 'interactive', provider, model,
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
      } catch {}
    }
  }
}

db.close();

console.log(`\nDeep Cost Recovery Complete`);
console.log(`  NEW events inserted: ${totalInserted}`);
console.log(`  Duplicates skipped: ${totalDuplicates}`);
console.log(`  Unattributable events: ${totalUnattributed}`);
console.log(`\nNewly recovered costs by issue:`);
const sorted = Object.entries(issueStats).sort((a, b) => b[1].cost - a[1].cost);
for (const [id, stats] of sorted) {
  console.log(`  ${id.padEnd(12)} ${String(stats.inserted).padStart(5)} events  $${stats.cost.toFixed(2)}`);
}
const totalCost = sorted.reduce((sum, [, s]) => sum + s.cost, 0);
console.log(`\n  TOTAL NEWLY RECOVERED: $${totalCost.toFixed(2)}`);
