#!/usr/bin/env npx tsx
/**
 * Test script for smart model selection
 *
 * Run: npx tsx src/lib/model-research/test-selection.ts
 */

import {
  selectModel,
  selectAllModels,
  formatSelectionResults,
} from '../smart-model-selector.js';
import { MODEL_CAPABILITIES } from '../model-capabilities.js';
import { ModelId } from '../settings.js';

// Simulate different user configurations

console.log('═══════════════════════════════════════════════════════════');
console.log('Smart Model Selection Test');
console.log('═══════════════════════════════════════════════════════════\n');

// Test 1: All Anthropic only (default)
console.log('Test 1: Anthropic Only (no external API keys)');
console.log('─'.repeat(60));
const anthropicOnly: ModelId[] = ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'];
const anthropicResults = selectAllModels(anthropicOnly);

for (const [workType, result] of Object.entries(anthropicResults)) {
  console.log(`  ${workType}: ${result.model}`);
}
console.log('\n');

// Test 2: All models available
console.log('Test 2: All Models Available');
console.log('─'.repeat(60));
const allModels = Object.keys(MODEL_CAPABILITIES) as ModelId[];
const allResults = selectAllModels(allModels);

for (const [workType, result] of Object.entries(allResults)) {
  console.log(`  ${workType}: ${result.model}`);
}
console.log('\n');

// Test 3: Detailed selection for a specific work type
console.log('Test 3: Detailed Selection - convoy:security-reviewer');
console.log('─'.repeat(60));
const securityResult = selectModel('convoy:security-reviewer', allModels);

console.log(`  Selected: ${securityResult.model}`);
console.log(`  Reason: ${securityResult.reason}`);
console.log(`  Score: ${securityResult.score.toFixed(1)}`);
console.log('\n  Top 5 candidates:');
securityResult.candidates
  .filter((c) => c.available)
  .sort((a, b) => b.score - a.score)
  .slice(0, 5)
  .forEach((c, i) => {
    console.log(`    ${i + 1}. ${c.model}: ${c.score.toFixed(1)}`);
  });
console.log('\n');

// Test 4: Anthropic + Kimi (common setup)
console.log('Test 4: Anthropic + Kimi (common affordable setup)');
console.log('─'.repeat(60));
const anthropicKimi: ModelId[] = [
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'kimi-k2',
  'kimi-k2.5',
];
const akResults = selectAllModels(anthropicKimi);

for (const [workType, result] of Object.entries(akResults)) {
  console.log(`  ${workType}: ${result.model}`);
}
console.log('\n');

// Test 5: Anthropic + Google
console.log('Test 5: Anthropic + Google');
console.log('─'.repeat(60));
const anthropicGoogle: ModelId[] = [
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
];
const agResults = selectAllModels(anthropicGoogle);

for (const [workType, result] of Object.entries(agResults)) {
  console.log(`  ${workType}: ${result.model}`);
}
console.log('\n');

// Summary
console.log('═══════════════════════════════════════════════════════════');
console.log('Summary: Model Distribution by Test');
console.log('═══════════════════════════════════════════════════════════\n');

function countModels(results: Record<string, { model: ModelId }>): Record<ModelId, number> {
  const counts: Partial<Record<ModelId, number>> = {};
  for (const r of Object.values(results)) {
    counts[r.model] = (counts[r.model] || 0) + 1;
  }
  return counts as Record<ModelId, number>;
}

const tests = [
  { name: 'Anthropic Only', results: anthropicResults },
  { name: 'All Models', results: allResults },
  { name: 'Anthropic + Kimi', results: akResults },
  { name: 'Anthropic + Google', results: agResults },
];

for (const test of tests) {
  console.log(`${test.name}:`);
  const counts = countModels(test.results);
  for (const [model, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${model}: ${count} work types`);
  }
  console.log('');
}

console.log('✅ All tests completed successfully');
