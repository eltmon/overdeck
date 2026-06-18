#!/usr/bin/env node
/**
 * Recover cost events from Claude Code transcript files.
 *
 * Scans ~/.claude/projects/ for transcript JSONL files,
 * infers issue ID from directory path, extracts usage data,
 * and inserts into the overdeck SQLite database.
 *
 * Deduplication is handled by the UNIQUE index on request_id.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { openNodeSqliteDatabase } from './sqlite.mjs';

const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects');
const DB_PATH = join(homedir(), '.overdeck', 'panopticon.db');

// Pricing table (same as record-cost-event.js)
const PRICING = [
  { provider: 'anthropic', model: 'claude-opus-4.6', inputPer1k: 5e-3, outputPer1k: 0.025, cacheReadPer1k: 5e-4, cacheWrite5mPer1k: 625e-5, cacheWrite1hPer1k: 0.01 },
  { provider: 'anthropic', model: 'claude-opus-4-6', inputPer1k: 5e-3, outputPer1k: 0.025, cacheReadPer1k: 5e-4, cacheWrite5mPer1k: 625e-5, cacheWrite1hPer1k: 0.01 },
  { provider: 'anthropic', model: 'claude-opus-4-1', inputPer1k: 0.015, outputPer1k: 0.075, cacheReadPer1k: 15e-4, cacheWrite5mPer1k: 0.01875, cacheWrite1hPer1k: 0.03 },
  { provider: 'anthropic', model: 'claude-opus-4', inputPer1k: 0.015, outputPer1k: 0.075, cacheReadPer1k: 15e-4, cacheWrite5mPer1k: 0.01875, cacheWrite1hPer1k: 0.03 },
  { provider: 'anthropic', model: 'claude-sonnet-4.5', inputPer1k: 3e-3, outputPer1k: 0.015, cacheReadPer1k: 3e-4, cacheWrite5mPer1k: 375e-5, cacheWrite1hPer1k: 6e-3 },
  { provider: 'anthropic', model: 'claude-sonnet-4-6', inputPer1k: 3e-3, outputPer1k: 0.015, cacheReadPer1k: 3e-4, cacheWrite5mPer1k: 375e-5, cacheWrite1hPer1k: 6e-3 },
  { provider: 'anthropic', model: 'claude-sonnet-4', inputPer1k: 3e-3, outputPer1k: 0.015, cacheReadPer1k: 3e-4, cacheWrite5mPer1k: 375e-5, cacheWrite1hPer1k: 6e-3 },
  { provider: 'anthropic', model: 'claude-haiku-4.5', inputPer1k: 1e-3, outputPer1k: 5e-3, cacheReadPer1k: 1e-4, cacheWrite5mPer1k: 125e-5, cacheWrite1hPer1k: 2e-3 },
  { provider: 'anthropic', model: 'claude-haiku-4', inputPer1k: 1e-3, outputPer1k: 5e-3, cacheReadPer1k: 1e-4, cacheWrite5mPer1k: 125e-5, cacheWrite1hPer1k: 2e-3 },
  { provider: 'anthropic', model: 'claude-haiku-3', inputPer1k: 25e-5, outputPer1k: 125e-5, cacheReadPer1k: 3e-5, cacheWrite5mPer1k: 3e-4, cacheWrite1hPer1k: 5e-4 },
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
  if ((pricing.model.includes('sonnet-4')) && totalInput > 200000) {
    inputMul = 2; outputMul = 1.5;
  }
  cost += usage.input / 1000 * pricing.inputPer1k * inputMul;
  cost += usage.output / 1000 * pricing.outputPer1k * outputMul;
  if (usage.cacheRead && pricing.cacheReadPer1k) cost += usage.cacheRead / 1000 * pricing.cacheReadPer1k;
  if (usage.cacheWrite && pricing.cacheWrite5mPer1k) cost += usage.cacheWrite / 1000 * pricing.cacheWrite5mPer1k;
  return Math.round(cost * 1e6) / 1e6;
}

function inferIssueId(dirName) {
  const match = dirName.match(/(pan|min|aud|krux|cli)[-](\d+)/i);
  if (match) return `${match[1].toUpperCase()}-${match[2]}`;
  return null;
}

function findTranscripts(projectDir) {
  const transcripts = [];
  try {
    const entries = readdirSync(projectDir, { recursive: true });
    for (const entry of entries) {
      if (entry.endsWith('.jsonl')) {
        const full = join(projectDir, entry);
        try { if (statSync(full).isFile()) transcripts.push(full); } catch {}
      }
    }
  } catch {}
  return transcripts;
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
let totalErrors = 0;
const issueStats = {};

const projectDirs = readdirSync(CLAUDE_PROJECTS);
for (const dirName of projectDirs) {
  const issueId = inferIssueId(dirName);
  if (!issueId) continue;

  const projectDir = join(CLAUDE_PROJECTS, dirName);
  if (!statSync(projectDir).isDirectory()) continue;

  const transcripts = findTranscripts(projectDir);
  if (transcripts.length === 0) continue;

  for (const transcript of transcripts) {
    let content;
    try { content = readFileSync(transcript, 'utf-8'); } catch { continue; }

    const lines = content.split('\n');
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

        // Use timestamp from the entry if available, otherwise from transcript modification time
        const ts = entry.timestamp || new Date(statSync(transcript).mtime).toISOString();

        const result = insert.run(
          ts, 'recovered', issueId, 'interactive', provider, model,
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
      } catch {
        totalErrors++;
      }
    }
  }
}

db.close();

// Report
console.log(`\nCost Recovery Complete`);
console.log(`  Inserted: ${totalInserted} new events`);
console.log(`  Duplicates skipped: ${totalDuplicates}`);
console.log(`  Errors: ${totalErrors}`);
console.log(`\nRecovered costs by issue:`);
const sorted = Object.entries(issueStats).sort((a, b) => b[1].cost - a[1].cost);
for (const [id, stats] of sorted) {
  console.log(`  ${id.padEnd(12)} ${stats.inserted} events  $${stats.cost.toFixed(2)}`);
}
const totalCost = sorted.reduce((sum, [, s]) => sum + s.cost, 0);
console.log(`\n  TOTAL RECOVERED: $${totalCost.toFixed(2)}`);
