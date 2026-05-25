#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PreToolUseEvent {
  tool_name?: string;
  tool_input?: {
    command?: string;
    [key: string]: unknown;
  };
}

interface Token {
  text: string;
  start: number;
  end: number;
}

type HookEnv = Record<string, string | undefined>;

const FLYWHEEL_RUN_ID_PATTERN = /^RUN-\d+$/;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function tokenize(command: string): Token[] {
  const tokens: Token[] = [];
  let text = '';
  let start = -1;
  let quote: 'single' | 'double' | null = null;
  let escape = false;

  const flush = (end: number): void => {
    if (start !== -1) tokens.push({ text, start, end });
    text = '';
    start = -1;
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (start === -1 && !/\s/.test(char)) start = index;

    if (escape) {
      text += char;
      escape = false;
      continue;
    }

    if (quote === 'single') {
      if (char === "'") quote = null;
      else text += char;
      continue;
    }

    if (quote === 'double') {
      if (char === '"') quote = null;
      else if (char === '\\') escape = true;
      else text += char;
      continue;
    }

    if (/\s/.test(char)) {
      flush(index);
      continue;
    }

    if (char === "'") {
      quote = 'single';
      continue;
    }

    if (char === '"') {
      quote = 'double';
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    text += char;
  }

  flush(command.length);
  return tokens;
}

function findGhIssueCreate(tokens: Token[]): number {
  for (let index = 0; index <= tokens.length - 3; index += 1) {
    if (tokens[index].text === 'gh' && tokens[index + 1].text === 'issue' && tokens[index + 2].text === 'create') {
      return index;
    }
  }
  return -1;
}

function containsFlywheelRunId(body: string): boolean {
  return /^Flywheel-Run-Id:/m.test(body);
}

function resolveDiscoveredIn(env: HookEnv): string | null {
  const agentId = env.PANOPTICON_AGENT_ID;
  if (!agentId || basename(agentId) !== agentId) return null;

  const panopticonHome = env.PANOPTICON_HOME ?? join(env.HOME ?? homedir(), '.panopticon');
  const statePath = join(panopticonHome, 'agents', agentId, 'state.json');
  if (!existsSync(statePath)) return null;

  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf-8')) as { issueId?: unknown };
    return typeof parsed.issueId === 'string' && parsed.issueId.trim() ? parsed.issueId.trim() : null;
  } catch {
    return null;
  }
}

function buildTrailer(env: HookEnv): string | null {
  const runId = env.PANOPTICON_FLYWHEEL_RUN_ID?.trim();
  if (!runId || !FLYWHEEL_RUN_ID_PATTERN.test(runId)) return null;

  const filedBy = env.PANOPTICON_FLYWHEEL_AGENT_ROLE === 'flywheel' ? 'agent' : 'operator';
  const discoveredIn = resolveDiscoveredIn(env);
  const lines = [
    '---',
    `Flywheel-Run-Id: ${runId}`,
    `Flywheel-Filed-By: ${filedBy}`,
    discoveredIn ? `Flywheel-Discovered-In: ${discoveredIn}` : undefined,
  ].filter((line): line is string => line !== undefined);
  return `\n\n${lines.join('\n')}\n`;
}

function replaceSpan(command: string, start: number, end: number, replacement: string): string {
  return `${command.slice(0, start)}${replacement}${command.slice(end)}`;
}

function findFlag(tokens: Token[], ghIndex: number, flagName: '--body' | '--body-file'): { flag: Token; value?: Token; inline: boolean } | null {
  for (let index = ghIndex + 3; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.text === flagName) return { flag: token, value: tokens[index + 1], inline: false };
    if (token.text.startsWith(`${flagName}=`)) return { flag: token, inline: true };
  }
  return null;
}

function inlineFlagValue(flag: Token): { value: string; valueStart: number; valueEnd: number } | null {
  const equalsOffset = flag.text.indexOf('=');
  if (equalsOffset === -1) return null;
  const valueStart = flag.start + equalsOffset + 1;
  return { value: flag.text.slice(equalsOffset + 1), valueStart, valueEnd: flag.end };
}

function appendBodyFlag(command: string, tokens: Token[], ghIndex: number, trailer: string): string | null {
  const bodyFlag = findFlag(tokens, ghIndex, '--body');
  if (!bodyFlag) return null;

  const body = bodyFlag.inline ? inlineFlagValue(bodyFlag.flag) : bodyFlag.value;
  if (!body) return null;
  const bodyText = 'text' in body ? body.text : body.value;
  if (containsFlywheelRunId(bodyText)) return command;

  const appended = `${bodyText}${trailer}`;
  if ('text' in body) return replaceSpan(command, body.start, body.end, shellQuote(appended));
  return replaceSpan(command, body.valueStart, body.valueEnd, shellQuote(appended));
}

function writeTempBodyFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pan-gh-issue-body-'));
  const path = join(dir, 'body.md');
  writeFileSync(path, body, 'utf-8');
  return path;
}

function appendBodyFileFlag(command: string, tokens: Token[], ghIndex: number, trailer: string): string | null {
  const bodyFileFlag = findFlag(tokens, ghIndex, '--body-file');
  if (!bodyFileFlag) return null;

  const pathValue = bodyFileFlag.inline ? inlineFlagValue(bodyFileFlag.flag) : bodyFileFlag.value;
  if (!pathValue) return null;
  const pathText = 'text' in pathValue ? pathValue.text : pathValue.value;

  if (pathText === '-') return appendStdinBody(command, tokens[ghIndex].start, trailer);
  if (!existsSync(pathText)) return null;

  const body = readFileSync(pathText, 'utf-8');
  if (containsFlywheelRunId(body)) return command;

  const tempPath = writeTempBodyFile(`${body}${trailer}`);
  if ('text' in pathValue) return replaceSpan(command, pathValue.start, pathValue.end, shellQuote(tempPath));
  return replaceSpan(command, pathValue.valueStart, pathValue.valueEnd, shellQuote(tempPath));
}

function findPipeBefore(command: string, beforeIndex: number): number {
  let quote: 'single' | 'double' | null = null;
  let escape = false;
  let pipeIndex = -1;

  for (let index = 0; index < beforeIndex; index += 1) {
    const char = command[index];
    if (escape) {
      escape = false;
      continue;
    }
    if (quote === 'single') {
      if (char === "'") quote = null;
      continue;
    }
    if (quote === 'double') {
      if (char === '"') quote = null;
      else if (char === '\\') escape = true;
      continue;
    }
    if (char === "'") quote = 'single';
    else if (char === '"') quote = 'double';
    else if (char === '\\') escape = true;
    else if (char === '|' && command[index + 1] !== '|' && command[index - 1] !== '|') pipeIndex = index;
  }

  return pipeIndex;
}

function appendHereDoc(command: string, trailer: string): string | null {
  const match = command.match(/(<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_-]*)['"]?[^\n]*\n)([\s\S]*?)(\n\2\s*)$/);
  if (!match || match.index === undefined) return null;
  const body = match[3];
  if (containsFlywheelRunId(body)) return command;
  const bodyStart = match.index + match[1].length;
  const bodyEnd = bodyStart + body.length;
  return replaceSpan(command, bodyStart, bodyEnd, `${body}${trailer}`);
}

function appendStdinBody(command: string, ghStart: number, trailer: string): string | null {
  if (command.includes('Flywheel-Run-Id:')) return command;

  const hereDoc = appendHereDoc(command, trailer);
  if (hereDoc) return hereDoc;

  const pipeIndex = findPipeBefore(command, ghStart);
  if (pipeIndex === -1) return null;

  const producer = command.slice(0, pipeIndex).trim();
  const consumer = command.slice(pipeIndex + 1).trimStart();
  if (!producer || !consumer) return null;
  return `{ ${producer}; printf %s ${shellQuote(trailer)}; } | ${consumer}`;
}

function buildUpdatedInput(command: string): Record<string, unknown> {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecisionReason: 'Flywheel issue provenance trailers added',
      updatedInput: { command },
    },
  };
}

export function rewriteGhIssueCreateCommand(command: string, env: HookEnv = process.env): string | null {
  const trailer = buildTrailer(env);
  if (!trailer) return null;

  const tokens = tokenize(command);
  const ghIndex = findGhIssueCreate(tokens);
  if (ghIndex === -1) return null;

  const bodyCommand = appendBodyFlag(command, tokens, ghIndex, trailer);
  if (bodyCommand !== null) return bodyCommand === command ? null : bodyCommand;

  const bodyFileCommand = appendBodyFileFlag(command, tokens, ghIndex, trailer);
  if (bodyFileCommand !== null) return bodyFileCommand === command ? null : bodyFileCommand;

  return null;
}

export function runGhIssueTrailerHook(input: string, env: HookEnv = process.env): string {
  let event: PreToolUseEvent;
  try {
    event = JSON.parse(input) as PreToolUseEvent;
  } catch {
    return '{}';
  }

  const command = event.tool_name === 'Bash' ? event.tool_input?.command : undefined;
  if (typeof command !== 'string') return '{}';

  const updatedCommand = rewriteGhIssueCreateCommand(command, env);
  if (!updatedCommand) return '{}';
  return JSON.stringify(buildUpdatedInput(updatedCommand));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const input = readFileSync(0, 'utf-8');
  process.stdout.write(runGhIssueTrailerHook(input));
}
