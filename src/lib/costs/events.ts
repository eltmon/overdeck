/**
 * Event Log Management for Cost Tracking
 *
 * Manages the append-only events.jsonl log that records all cost events.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ============== Types ==============

export interface CostEvent {
  ts: string;              // ISO timestamp
  type: 'cost';            // Event type (always 'cost' for now)
  agentId: string;         // Agent identifier
  issueId: string;         // Issue identifier (e.g., "PAN-81")
  sessionType: string;     // Session type (e.g., "implementation", "planning")
  provider: string;        // AI provider (e.g., "anthropic", "openai", "google")
  model: string;           // Model name (e.g., "claude-sonnet-4")
  input: number;           // Input tokens
  output: number;          // Output tokens
  cacheRead: number;       // Cache read tokens
  cacheWrite: number;      // Cache write tokens
  cost: number;            // Cost in USD
}

export interface EventMetadata {
  lastEventTs: string | null;
  lastEventLine: number;
  totalEvents: number;
}

export interface ReadEventsOptions {
  issueId?: string;
  agentId?: string;
  provider?: string;
  startDate?: string;      // ISO date string
  endDate?: string;        // ISO date string
  limit?: number;
  offset?: number;
}

// ============== Constants ==============

const COSTS_DIR = join(homedir(), '.panopticon', 'costs');
const EVENTS_FILE = join(COSTS_DIR, 'events.jsonl');

// ============== Initialization ==============

/**
 * Ensure the costs directory and events file exist
 */
function ensureEventsFile(): void {
  mkdirSync(COSTS_DIR, { recursive: true });
  if (!existsSync(EVENTS_FILE)) {
    writeFileSync(EVENTS_FILE, '', 'utf-8');
  }
}

// ============== Event Writing ==============

/**
 * Append a cost event to the log
 */
export function appendCostEvent(event: CostEvent): void {
  ensureEventsFile();

  // Validate required fields
  if (!event.ts || !event.agentId || !event.issueId || !event.model) {
    throw new Error('Missing required event fields: ts, agentId, issueId, model');
  }

  // Append to log
  const line = JSON.stringify(event) + '\n';
  appendFileSync(EVENTS_FILE, line, 'utf-8');
}

// ============== Event Reading ==============

/**
 * Read all events from the log with optional filters
 */
export function readEvents(options: ReadEventsOptions = {}): CostEvent[] {
  if (!existsSync(EVENTS_FILE)) {
    return [];
  }

  const content = readFileSync(EVENTS_FILE, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  let events: CostEvent[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as CostEvent;
      events.push(event);
    } catch (err) {
      // Skip malformed lines
      console.warn('Skipping malformed event line:', line.slice(0, 100));
    }
  }

  // Apply filters
  if (options.issueId) {
    events = events.filter(e => e.issueId.toLowerCase() === options.issueId!.toLowerCase());
  }

  if (options.agentId) {
    events = events.filter(e => e.agentId === options.agentId);
  }

  if (options.provider) {
    events = events.filter(e => e.provider === options.provider);
  }

  if (options.startDate) {
    events = events.filter(e => e.ts >= options.startDate!);
  }

  if (options.endDate) {
    events = events.filter(e => e.ts <= options.endDate!);
  }

  // Apply offset and limit
  if (options.offset) {
    events = events.slice(options.offset);
  }

  if (options.limit) {
    events = events.slice(0, options.limit);
  }

  return events;
}

/**
 * Get the last N events from the log
 */
export function tailEvents(n: number): CostEvent[] {
  if (!existsSync(EVENTS_FILE)) {
    return [];
  }

  const content = readFileSync(EVENTS_FILE, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  const lastLines = lines.slice(-n);
  const events: CostEvent[] = [];

  for (const line of lastLines) {
    try {
      events.push(JSON.parse(line) as CostEvent);
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}

/**
 * Read events starting from a specific line number
 * Useful for incremental processing
 */
export function readEventsFromLine(startLine: number): CostEvent[] {
  if (!existsSync(EVENTS_FILE)) {
    return [];
  }

  const content = readFileSync(EVENTS_FILE, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  const events: CostEvent[] = [];

  for (let i = startLine; i < lines.length; i++) {
    try {
      events.push(JSON.parse(lines[i]) as CostEvent);
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}

/**
 * Get metadata about the event log
 */
export function getLastEventMetadata(): EventMetadata {
  if (!existsSync(EVENTS_FILE)) {
    return {
      lastEventTs: null,
      lastEventLine: 0,
      totalEvents: 0,
    };
  }

  const content = readFileSync(EVENTS_FILE, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  let lastEventTs: string | null = null;

  if (lines.length > 0) {
    try {
      const lastEvent = JSON.parse(lines[lines.length - 1]) as CostEvent;
      lastEventTs = lastEvent.ts;
    } catch {
      // Can't parse last event
    }
  }

  return {
    lastEventTs,
    lastEventLine: lines.length,
    totalEvents: lines.length,
  };
}

/**
 * Replace the entire events log with new content
 * Used by retention pruning - DANGEROUS, use with caution
 */
export function replaceEventsFile(events: CostEvent[]): void {
  ensureEventsFile();

  // Write to temp file first
  const tempFile = EVENTS_FILE + '.tmp';
  const content = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(tempFile, content, 'utf-8');

  // Atomic rename
  const { renameSync } = require('fs');
  renameSync(tempFile, EVENTS_FILE);
}

/**
 * Check if events file exists
 */
export function eventsFileExists(): boolean {
  return existsSync(EVENTS_FILE);
}

/**
 * Get the path to the events file
 */
export function getEventsFilePath(): string {
  return EVENTS_FILE;
}
