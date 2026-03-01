#!/usr/bin/env node

// scripts/record-cost-event.ts
import { readFileSync as readFileSync3, existsSync as existsSync3, writeFileSync as writeFileSync3, mkdirSync as mkdirSync3, openSync, readSync, fstatSync, closeSync } from "fs";
import { execFileSync } from "child_process";
import { join as join5 } from "path";
import { homedir as homedir3 } from "os";

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
var ARCHIVES_DIR = join(PANOPTICON_HOME, "archives");
var TRAEFIK_DIR = join(PANOPTICON_HOME, "traefik");
var TRAEFIK_DYNAMIC_DIR = join(TRAEFIK_DIR, "dynamic");
var TRAEFIK_CERTS_DIR = join(TRAEFIK_DIR, "certs");
var CERTS_DIR = join(PANOPTICON_HOME, "certs");
var CONFIG_FILE = join(CONFIG_DIR, "config.toml");
var SETTINGS_FILE = join(CONFIG_DIR, "settings.json");
var CLAUDE_DIR = join(homedir(), ".claude");
var LEGACY_RUNTIME_DIRS = {
  codex: join(homedir(), ".codex"),
  cursor: join(homedir(), ".cursor"),
  gemini: join(homedir(), ".gemini"),
  opencode: join(homedir(), ".opencode")
};
var SYNC_TARGET = {
  skills: join(CLAUDE_DIR, "skills"),
  commands: join(CLAUDE_DIR, "commands"),
  agents: join(CLAUDE_DIR, "agents")
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
var SOURCE_AGENTS_DIR = join(packageRoot, "agents");
var SOURCE_RULES_DIR = join(packageRoot, "rules");
var CACHE_AGENTS_DIR = join(PANOPTICON_HOME, "agent-definitions");
var CACHE_RULES_DIR = join(PANOPTICON_HOME, "rules");
var CACHE_MANIFEST = join(PANOPTICON_HOME, ".manifest.json");
var DOCS_DIR = join(PANOPTICON_HOME, "docs");
var PRDS_DIR = join(DOCS_DIR, "prds");
var PRD_DRAFTS_DIR = join(PRDS_DIR, "drafts");
var PRD_PUBLISHED_DIR = join(PRDS_DIR, "published");

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
function calculateCost(usage, pricing) {
  let cost = 0;
  let inputMultiplier = 1;
  let outputMultiplier = 1;
  const totalInputTokens = usage.inputTokens + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0);
  if ((pricing.model === "claude-sonnet-4" || pricing.model === "claude-sonnet-4.5") && totalInputTokens > 2e5) {
    inputMultiplier = 2;
    outputMultiplier = 1.5;
  }
  cost += usage.inputTokens / 1e3 * pricing.inputPer1k * inputMultiplier;
  cost += usage.outputTokens / 1e3 * pricing.outputPer1k * outputMultiplier;
  if (usage.cacheReadTokens && pricing.cacheReadPer1k) {
    cost += usage.cacheReadTokens / 1e3 * pricing.cacheReadPer1k;
  }
  if (usage.cacheWriteTokens) {
    const ttl = usage.cacheTTL || "5m";
    const cacheWritePrice = ttl === "1h" ? pricing.cacheWrite1hPer1k : pricing.cacheWrite5mPer1k;
    if (cacheWritePrice) {
      cost += usage.cacheWriteTokens / 1e3 * cacheWritePrice;
    }
  }
  return Math.round(cost * 1e6) / 1e6;
}
function getPricing(provider, model) {
  let pricing = DEFAULT_PRICING.find(
    (p) => p.provider === provider && p.model === model
  );
  if (!pricing) {
    pricing = DEFAULT_PRICING.find(
      (p) => p.provider === provider && model.startsWith(p.model)
    );
  }
  return pricing || null;
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
function appendCostEvent(event2) {
  ensureEventsFile();
  if (!event2.ts || !event2.agentId || !event2.issueId || !event2.model) {
    throw new Error("Missing required event fields: ts, agentId, issueId, model");
  }
  const line = JSON.stringify(event2) + "\n";
  appendFileSync(getEventsFile(), line, "utf-8");
}

// src/lib/tldr-daemon.ts
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync as existsSync2, writeFileSync as writeFileSync2, readFileSync as readFileSync2, mkdirSync as mkdirSync2, unlinkSync } from "fs";
import { join as join4 } from "path";
function getTldrMetrics(workspacePath, sinceCheckpoint = false) {
  const tldrDir = join4(workspacePath, ".tldr");
  const interceptionsLog = join4(tldrDir, "interceptions.log");
  const bypassesLog = join4(tldrDir, "bypasses.log");
  const checkpointFile = join4(tldrDir, "metrics-checkpoint.json");
  let interceptionsStartLine = 0;
  let bypassesStartLine = 0;
  if (sinceCheckpoint && existsSync2(checkpointFile)) {
    try {
      const checkpoint = JSON.parse(readFileSync2(checkpointFile, "utf-8"));
      interceptionsStartLine = checkpoint.interceptionsLine || 0;
      bypassesStartLine = checkpoint.bypassesLine || 0;
    } catch {
    }
  }
  const allInterceptionLines = existsSync2(interceptionsLog) ? readFileSync2(interceptionsLog, "utf-8").split("\n").filter((l) => l.trim()) : [];
  const newInterceptions = allInterceptionLines.slice(interceptionsStartLine);
  let estimatedTokensSaved = 0;
  const filesAnalyzed = [];
  for (const line of newInterceptions) {
    const parts = line.trim().split(" ");
    if (parts.length >= 3) {
      const fileSizeBytes = parseInt(parts[1], 10) || 0;
      const relPath = parts.slice(2).join(" ");
      const fullTokens = Math.round(fileSizeBytes / 4);
      estimatedTokensSaved += Math.max(0, fullTokens - 1e3);
      if (relPath && !filesAnalyzed.includes(relPath)) {
        filesAnalyzed.push(relPath);
      }
    }
  }
  const allBypassLines = existsSync2(bypassesLog) ? readFileSync2(bypassesLog, "utf-8").split("\n").filter((l) => l.trim()) : [];
  const newBypasses = allBypassLines.slice(bypassesStartLine);
  const bypassReasons = {};
  for (const line of newBypasses) {
    const parts = line.trim().split(" ");
    if (parts.length >= 2) {
      const reason = parts[1];
      bypassReasons[reason] = (bypassReasons[reason] || 0) + 1;
    }
  }
  return {
    interceptions: newInterceptions.length,
    bypasses: newBypasses.length,
    estimatedTokensSaved,
    filesAnalyzed,
    bypassReasons
  };
}
function captureTldrMetrics(workspacePath) {
  const tldrDir = join4(workspacePath, ".tldr");
  if (!existsSync2(tldrDir)) {
    return null;
  }
  const metrics = getTldrMetrics(workspacePath, true);
  const interceptionsLog = join4(tldrDir, "interceptions.log");
  const bypassesLog = join4(tldrDir, "bypasses.log");
  const checkpointFile = join4(tldrDir, "metrics-checkpoint.json");
  const interceptionsTotal = existsSync2(interceptionsLog) ? readFileSync2(interceptionsLog, "utf-8").split("\n").filter((l) => l.trim()).length : 0;
  const bypassesTotal = existsSync2(bypassesLog) ? readFileSync2(bypassesLog, "utf-8").split("\n").filter((l) => l.trim()).length : 0;
  const checkpoint = {
    interceptionsLine: interceptionsTotal,
    bypassesLine: bypassesTotal,
    capturedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  try {
    writeFileSync2(checkpointFile, JSON.stringify(checkpoint, null, 2), "utf-8");
  } catch {
  }
  return metrics;
}
var execAsync = promisify(exec);
var TLDR_STATE_DIR = join4(PANOPTICON_HOME, "tldr");

// scripts/record-cost-event.ts
var event;
try {
  const input = readFileSync3(0, "utf-8");
  event = JSON.parse(input);
} catch {
  process.exit(0);
}
var transcriptPath = event?.transcript_path;
if (!transcriptPath || !existsSync3(transcriptPath)) {
  process.exit(0);
}
var sessionId = event?.session_id || "unknown";
var stateDir = join5(process.env.HOME || homedir3(), ".panopticon", "costs", "state");
mkdirSync3(stateDir, { recursive: true });
var stateFile = join5(stateDir, `${sessionId}.offset`);
var lastOffset = 0;
if (existsSync3(stateFile)) {
  try {
    lastOffset = parseInt(readFileSync3(stateFile, "utf-8").trim(), 10) || 0;
  } catch {
  }
}
var seenFile = join5(stateDir, `${sessionId}.seen`);
var seenRequestIds = /* @__PURE__ */ new Set();
if (existsSync3(seenFile)) {
  try {
    const seenContent = readFileSync3(seenFile, "utf-8").trim();
    if (seenContent) {
      for (const id of seenContent.split("\n")) {
        if (id.trim()) seenRequestIds.add(id.trim());
      }
    }
  } catch {
  }
}
var fd;
try {
  fd = openSync(transcriptPath, "r");
} catch {
  process.exit(0);
}
var stat = fstatSync(fd);
if (stat.size <= lastOffset) {
  closeSync(fd);
  writeFileSync3(stateFile, String(stat.size), "utf-8");
  process.exit(0);
}
var bytesToRead = stat.size - lastOffset;
var buffer = Buffer.alloc(bytesToRead);
readSync(fd, buffer, 0, bytesToRead, lastOffset);
closeSync(fd);
var newContent = buffer.toString("utf-8");
var lines = newContent.split("\n");
var agentId = process.env.PANOPTICON_AGENT_ID || "unattributed";
var issueId = process.env.PANOPTICON_ISSUE_ID || "";
var sessionType = process.env.PANOPTICON_SESSION_TYPE || "implementation";
if (!issueId || issueId === "UNKNOWN") {
  try {
    const branch = execFileSync("git", ["branch", "--show-current"], {
      encoding: "utf-8",
      timeout: 2e3,
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    const branchMatch = branch.match(/(pan|min|aud)[-](\d+)/i);
    if (branchMatch) {
      issueId = `${branchMatch[1].toUpperCase()}-${branchMatch[2]}`;
    }
  } catch {
  }
}
if (!issueId) {
  issueId = "UNKNOWN";
}
var tldrMetrics = null;
try {
  const workspaceRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
    timeout: 2e3,
    stdio: ["pipe", "pipe", "pipe"]
  }).trim();
  if (workspaceRoot) {
    tldrMetrics = captureTldrMetrics(workspaceRoot);
  }
} catch {
}
var tldrAttachedToFirstEvent = false;
for (const line of lines) {
  if (!line.trim()) continue;
  try {
    const entry = JSON.parse(line);
    if (entry.type !== "assistant" || !entry.message?.usage) {
      continue;
    }
    const requestId = entry.requestId;
    if (requestId) {
      if (seenRequestIds.has(requestId)) {
        continue;
      }
      seenRequestIds.add(requestId);
    }
    const usage = entry.message.usage;
    const model = entry.message.model || "claude-sonnet-4";
    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const cacheReadTokens = usage.cache_read_input_tokens || 0;
    const cacheWriteTokens = usage.cache_creation_input_tokens || 0;
    if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheWriteTokens === 0) {
      continue;
    }
    let provider = "anthropic";
    if (model.includes("gpt")) {
      provider = "openai";
    } else if (model.includes("gemini")) {
      provider = "google";
    }
    const pricing = getPricing(provider, model);
    if (!pricing) continue;
    const cost = calculateCost({
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      cacheTTL: "5m"
    }, pricing);
    const tldrFields = tldrMetrics && !tldrAttachedToFirstEvent && tldrMetrics.interceptions + tldrMetrics.bypasses > 0 ? {
      tldrInterceptions: tldrMetrics.interceptions,
      tldrBypasses: tldrMetrics.bypasses,
      tldrTokensSaved: tldrMetrics.estimatedTokensSaved,
      tldrBypassReasons: Object.keys(tldrMetrics.bypassReasons).length > 0 ? tldrMetrics.bypassReasons : void 0
    } : {};
    if (tldrMetrics && !tldrAttachedToFirstEvent) {
      tldrAttachedToFirstEvent = true;
    }
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
      cost,
      ...requestId ? { requestId } : {},
      ...tldrFields
    });
  } catch {
  }
}
writeFileSync3(stateFile, String(stat.size), "utf-8");
if (seenRequestIds.size > 0) {
  writeFileSync3(seenFile, Array.from(seenRequestIds).join("\n") + "\n", "utf-8");
}
process.exit(0);
