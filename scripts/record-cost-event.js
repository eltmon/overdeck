#!/usr/bin/env node

// scripts/record-cost-event.ts
import { readFileSync as readFileSync2 } from "fs";

// src/lib/cost.ts
import { join as join2 } from "path";

// src/lib/paths.ts
import { homedir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
var PANOPTICON_HOME = process.env.PANOPTICON_HOME || join(homedir(), ".panopticon");
var CONFIG_DIR = PANOPTICON_HOME;
var SKILLS_DIR = join(PANOPTICON_HOME, "skills");
var COMMANDS_DIR = join(PANOPTICON_HOME, "commands");
var AGENTS_DIR = join(PANOPTICON_HOME, "agents");
var BIN_DIR = join(PANOPTICON_HOME, "bin");
var BACKUPS_DIR = join(PANOPTICON_HOME, "backups");
var COSTS_DIR = join(PANOPTICON_HOME, "costs");
var HEARTBEATS_DIR = join(PANOPTICON_HOME, "heartbeats");
var TRAEFIK_DIR = join(PANOPTICON_HOME, "traefik");
var TRAEFIK_DYNAMIC_DIR = join(TRAEFIK_DIR, "dynamic");
var TRAEFIK_CERTS_DIR = join(TRAEFIK_DIR, "certs");
var CERTS_DIR = join(PANOPTICON_HOME, "certs");
var CONFIG_FILE = join(CONFIG_DIR, "config.toml");
var SETTINGS_FILE = join(CONFIG_DIR, "settings.json");
var CLAUDE_DIR = join(homedir(), ".claude");
var CODEX_DIR = join(homedir(), ".codex");
var CURSOR_DIR = join(homedir(), ".cursor");
var GEMINI_DIR = join(homedir(), ".gemini");
var OPENCODE_DIR = join(homedir(), ".opencode");
var SYNC_TARGETS = {
  claude: {
    skills: join(CLAUDE_DIR, "skills"),
    commands: join(CLAUDE_DIR, "commands"),
    agents: join(CLAUDE_DIR, "agents")
  },
  codex: {
    skills: join(CODEX_DIR, "skills"),
    commands: join(CODEX_DIR, "commands"),
    agents: join(CODEX_DIR, "agents")
  },
  cursor: {
    skills: join(CURSOR_DIR, "skills"),
    commands: join(CURSOR_DIR, "commands"),
    agents: join(CURSOR_DIR, "agents")
  },
  gemini: {
    skills: join(GEMINI_DIR, "skills"),
    commands: join(GEMINI_DIR, "commands"),
    agents: join(GEMINI_DIR, "agents")
  },
  opencode: {
    skills: join(OPENCODE_DIR, "skills"),
    commands: join(OPENCODE_DIR, "commands"),
    agents: join(OPENCODE_DIR, "agents")
  }
};
var TEMPLATES_DIR = join(PANOPTICON_HOME, "templates");
var CLAUDE_MD_TEMPLATES = join(TEMPLATES_DIR, "claude-md", "sections");
var currentFile = fileURLToPath(import.meta.url);
var currentDir = dirname(currentFile);
var packageRoot;
if (currentDir.includes("/src/")) {
  packageRoot = dirname(dirname(currentDir));
} else {
  packageRoot = currentDir.endsWith("/lib") ? dirname(dirname(currentDir)) : dirname(currentDir);
}
var SOURCE_TEMPLATES_DIR = join(packageRoot, "templates");
var SOURCE_TRAEFIK_TEMPLATES = join(SOURCE_TEMPLATES_DIR, "traefik");
var SOURCE_SCRIPTS_DIR = join(packageRoot, "scripts");
var SOURCE_SKILLS_DIR = join(packageRoot, "skills");
var SOURCE_DEV_SKILLS_DIR = join(packageRoot, "dev-skills");

// src/lib/cost.ts
var DEFAULT_PRICING = [
  // Anthropic - 4.6 series
  { provider: "anthropic", model: "claude-opus-4.6", inputPer1k: 5e-3, outputPer1k: 0.025, cacheReadPer1k: 5e-4, cacheWrite5mPer1k: 625e-5, cacheWrite1hPer1k: 0.01, currency: "USD" },
  { provider: "anthropic", model: "claude-sonnet-4.5", inputPer1k: 3e-3, outputPer1k: 0.015, cacheReadPer1k: 3e-4, cacheWrite5mPer1k: 375e-5, cacheWrite1hPer1k: 6e-3, currency: "USD" },
  { provider: "anthropic", model: "claude-haiku-4.5", inputPer1k: 1e-3, outputPer1k: 5e-3, cacheReadPer1k: 1e-4, cacheWrite5mPer1k: 125e-5, cacheWrite1hPer1k: 2e-3, currency: "USD" },
  // Anthropic - 4.x series
  { provider: "anthropic", model: "claude-opus-4-1", inputPer1k: 0.015, outputPer1k: 0.075, cacheReadPer1k: 15e-4, cacheWrite5mPer1k: 0.01875, cacheWrite1hPer1k: 0.03, currency: "USD" },
  { provider: "anthropic", model: "claude-opus-4", inputPer1k: 0.015, outputPer1k: 0.075, cacheReadPer1k: 15e-4, cacheWrite5mPer1k: 0.01875, cacheWrite1hPer1k: 0.03, currency: "USD" },
  { provider: "anthropic", model: "claude-sonnet-4", inputPer1k: 3e-3, outputPer1k: 0.015, cacheReadPer1k: 3e-4, cacheWrite5mPer1k: 375e-5, cacheWrite1hPer1k: 6e-3, currency: "USD" },
  // Anthropic - Legacy
  { provider: "anthropic", model: "claude-haiku-3", inputPer1k: 25e-5, outputPer1k: 125e-5, cacheReadPer1k: 3e-5, cacheWrite5mPer1k: 3e-4, cacheWrite1hPer1k: 5e-4, currency: "USD" },
  // OpenAI
  { provider: "openai", model: "gpt-4-turbo", inputPer1k: 0.01, outputPer1k: 0.03, currency: "USD" },
  { provider: "openai", model: "gpt-4o", inputPer1k: 5e-3, outputPer1k: 0.015, currency: "USD" },
  { provider: "openai", model: "gpt-4o-mini", inputPer1k: 15e-5, outputPer1k: 6e-4, currency: "USD" },
  // Google
  { provider: "google", model: "gemini-1.5-pro", inputPer1k: 125e-5, outputPer1k: 5e-3, currency: "USD" },
  { provider: "google", model: "gemini-1.5-flash", inputPer1k: 75e-6, outputPer1k: 3e-4, currency: "USD" },
  // Moonshot AI (Kimi)
  { provider: "custom", model: "kimi-for-coding", inputPer1k: 6e-4, outputPer1k: 2e-3, cacheReadPer1k: 6e-5, cacheWrite5mPer1k: 75e-5, currency: "USD" },
  { provider: "custom", model: "kimi-k2.5", inputPer1k: 6e-4, outputPer1k: 2e-3, cacheReadPer1k: 6e-5, cacheWrite5mPer1k: 75e-5, currency: "USD" }
];
function calculateCost(usage2, pricing2) {
  let cost2 = 0;
  let inputMultiplier = 1;
  let outputMultiplier = 1;
  const totalInputTokens = usage2.inputTokens + (usage2.cacheReadTokens || 0) + (usage2.cacheWriteTokens || 0);
  if ((pricing2.model === "claude-sonnet-4" || pricing2.model === "claude-sonnet-4.5") && totalInputTokens > 2e5) {
    inputMultiplier = 2;
    outputMultiplier = 1.5;
  }
  cost2 += usage2.inputTokens / 1e3 * pricing2.inputPer1k * inputMultiplier;
  cost2 += usage2.outputTokens / 1e3 * pricing2.outputPer1k * outputMultiplier;
  if (usage2.cacheReadTokens && pricing2.cacheReadPer1k) {
    cost2 += usage2.cacheReadTokens / 1e3 * pricing2.cacheReadPer1k;
  }
  if (usage2.cacheWriteTokens) {
    const ttl = usage2.cacheTTL || "5m";
    const cacheWritePrice = ttl === "1h" ? pricing2.cacheWrite1hPer1k : pricing2.cacheWrite5mPer1k;
    if (cacheWritePrice) {
      cost2 += usage2.cacheWriteTokens / 1e3 * cacheWritePrice;
    }
  }
  return Math.round(cost2 * 1e6) / 1e6;
}
function getPricing(provider2, model2) {
  let pricing2 = DEFAULT_PRICING.find(
    (p) => p.provider === provider2 && p.model === model2
  );
  if (!pricing2) {
    pricing2 = DEFAULT_PRICING.find(
      (p) => p.provider === provider2 && model2.startsWith(p.model)
    );
  }
  return pricing2 || null;
}
var BUDGETS_FILE = join2(COSTS_DIR, "budgets.json");

// src/lib/costs/events.ts
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, renameSync } from "fs";
import { join as join3 } from "path";
import { homedir as homedir2 } from "os";
function getCostsDir() {
  return join3(process.env.HOME || homedir2(), ".panopticon", "costs");
}
function getEventsFile() {
  return join3(getCostsDir(), "events.jsonl");
}
function ensureEventsFile() {
  const costsDir = getCostsDir();
  const eventsFile = getEventsFile();
  mkdirSync(costsDir, { recursive: true });
  if (!existsSync(eventsFile)) {
    writeFileSync(eventsFile, "", "utf-8");
  }
}
function appendCostEvent(event) {
  ensureEventsFile();
  if (!event.ts || !event.agentId || !event.issueId || !event.model) {
    throw new Error("Missing required event fields: ts, agentId, issueId, model");
  }
  const line = JSON.stringify(event) + "\n";
  appendFileSync(getEventsFile(), line, "utf-8");
}

// scripts/record-cost-event.ts
var toolInfo;
try {
  const input = readFileSync2(0, "utf-8");
  toolInfo = JSON.parse(input);
} catch (err) {
  process.exit(0);
}
var usage = toolInfo?.usage || toolInfo?.message?.usage;
if (!usage) {
  process.exit(0);
}
var inputTokens = usage.input_tokens || 0;
var outputTokens = usage.output_tokens || 0;
var cacheReadTokens = usage.cache_read_input_tokens || 0;
var cacheWriteTokens = usage.cache_creation_input_tokens || 0;
if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheWriteTokens === 0) {
  process.exit(0);
}
var model = toolInfo?.model || toolInfo?.message?.model || "claude-sonnet-4";
var provider = "anthropic";
if (model.includes("gpt")) {
  provider = "openai";
} else if (model.includes("gemini")) {
  provider = "google";
}
var pricing = getPricing(provider, model);
if (!pricing) {
  console.warn(`No pricing found for ${provider}/${model}`);
  process.exit(0);
}
var cost = calculateCost({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheWriteTokens,
  cacheTTL: "5m"
}, pricing);
var agentId = process.env.PANOPTICON_AGENT_ID || "unattributed";
var issueId = process.env.PANOPTICON_ISSUE_ID || "UNKNOWN";
var sessionType = process.env.PANOPTICON_SESSION_TYPE || "implementation";
try {
  appendCostEvent({
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    type: "cost",
    agentId,
    issueId,
    sessionType,
    provider,
    model,
    input: inputTokens,
    output: outputTokens,
    cacheRead: cacheReadTokens,
    cacheWrite: cacheWriteTokens,
    cost
  });
} catch (err) {
  console.error("Failed to record cost event:", err);
}
process.exit(0);
