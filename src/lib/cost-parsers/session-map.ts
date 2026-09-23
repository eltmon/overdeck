/**
 * Session-to-Issue Linking
 *
 * Track which Claude Code sessions belong to which issues.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { OVERDECK_HOME } from '../paths.js';

const SESSION_MAP_FILE = join(OVERDECK_HOME, 'session-map.json');

/**
 * Session record
 */
export interface SessionRecord {
  id: string;
  startedAt: string;
  endedAt: string | null;
  type: 'planning' | 'implementation' | 'review' | 'other';
  model: string;
  runtime: string;
  cost?: number;
  tokenCount?: number;
  agentId?: string;
}

/**
 * Issue sessions mapping
 */
export interface IssueSessionMap {
  [issueId: string]: {
    sessions: SessionRecord[];
    totalCost?: number;
    totalTokens?: number;
  };
}

/**
 * Session map data
 */
export interface SessionMapData {
  version: number;
  issues: IssueSessionMap;
  lastUpdated: string;
}

const DEFAULT_DATA: SessionMapData = {
  version: 1,
  issues: {},
  lastUpdated: new Date().toISOString(),
};

/**
 * Load session map from file
 */
export function loadSessionMapSync(): SessionMapData {
  try {
    if (existsSync(SESSION_MAP_FILE)) {
      const content = readFileSync(SESSION_MAP_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.warn('Failed to load session map:', error);
  }
  return { ...DEFAULT_DATA };
}

/**
 * Save session map to file
 */
export function saveSessionMapSync(data: SessionMapData): void {
  mkdirSync(OVERDECK_HOME, { recursive: true });
  data.lastUpdated = new Date().toISOString();
  writeFileSync(SESSION_MAP_FILE, JSON.stringify(data, null, 2));
}

/**
 * Link a session to an issue
 */
export function linkSessionToIssueSync(
  sessionId: string,
  issueId: string,
  options: {
    type?: SessionRecord['type'];
    model?: string;
    runtime?: string;
    agentId?: string;
  } = {}
): SessionRecord {
  const data = loadSessionMapSync();

  if (!data.issues[issueId]) {
    data.issues[issueId] = { sessions: [] };
  }

  // Check if session already linked
  const existing = data.issues[issueId].sessions.find(s => s.id === sessionId);
  if (existing) {
    return existing;
  }

  const record: SessionRecord = {
    id: sessionId,
    startedAt: new Date().toISOString(),
    endedAt: null,
    type: options.type || 'implementation',
    model: options.model || 'claude-sonnet-4',
    runtime: options.runtime || 'claude',
    agentId: options.agentId,
  };

  data.issues[issueId].sessions.push(record);
  saveSessionMapSync(data);

  return record;
}

/**
 * Mark a session as completed
 */
export function completeSessionSync(
  sessionId: string,
  issueId: string,
  results: {
    cost?: number;
    tokenCount?: number;
  } = {}
): SessionRecord | null {
  const data = loadSessionMapSync();

  const issueData = data.issues[issueId];
  if (!issueData) return null;

  const session = issueData.sessions.find(s => s.id === sessionId);
  if (!session) return null;

  session.endedAt = new Date().toISOString();
  session.cost = results.cost;
  session.tokenCount = results.tokenCount;

  // Recalculate totals
  recalculateIssueTotals(data, issueId);

  saveSessionMapSync(data);
  return session;
}

/**
 * Recalculate issue totals
 */
function recalculateIssueTotals(data: SessionMapData, issueId: string): void {
  const issueData = data.issues[issueId];
  if (!issueData) return;

  issueData.totalCost = issueData.sessions.reduce(
    (sum, s) => sum + (s.cost || 0),
    0
  );
  issueData.totalTokens = issueData.sessions.reduce(
    (sum, s) => sum + (s.tokenCount || 0),
    0
  );
}

/**
 * Get sessions for an issue
 */
export function getIssueSessionsSync(issueId: string): SessionRecord[] {
  const data = loadSessionMapSync();
  return data.issues[issueId]?.sessions || [];
}

/**
 * Get issue cost summary
 */
export function getIssueCostSummarySync(issueId: string): {
  totalCost: number;
  totalTokens: number;
  sessionCount: number;
  sessions: SessionRecord[];
} | null {
  const data = loadSessionMapSync();
  const issueData = data.issues[issueId];

  if (!issueData) {
    return null;
  }

  return {
    totalCost: issueData.totalCost || 0,
    totalTokens: issueData.totalTokens || 0,
    sessionCount: issueData.sessions.length,
    sessions: issueData.sessions,
  };
}

/**
 * Get all issues with costs
 */
export function getAllIssuesWithCostsSync(): Array<{
  issueId: string;
  totalCost: number;
  totalTokens: number;
  sessionCount: number;
}> {
  const data = loadSessionMapSync();

  return Object.entries(data.issues).map(([issueId, issueData]) => ({
    issueId,
    totalCost: issueData.totalCost || 0,
    totalTokens: issueData.totalTokens || 0,
    sessionCount: issueData.sessions.length,
  }));
}

/**
 * Get session by ID (searches all issues)
 */
export function findSessionByIdSync(sessionId: string): { issueId: string; session: SessionRecord } | null {
  const data = loadSessionMapSync();

  for (const [issueId, issueData] of Object.entries(data.issues)) {
    const session = issueData.sessions.find(s => s.id === sessionId);
    if (session) {
      return { issueId, session };
    }
  }

  return null;
}

/**
 * Update session cost from JSONL parsing
 */
export function updateSessionFromJSONLSync(
  sessionId: string,
  issueId: string,
  usage: {
    cost: number;
    tokenCount: number;
    model?: string;
  }
): SessionRecord | null {
  const data = loadSessionMapSync();

  const issueData = data.issues[issueId];
  if (!issueData) return null;

  const session = issueData.sessions.find(s => s.id === sessionId);
  if (!session) return null;

  session.cost = usage.cost;
  session.tokenCount = usage.tokenCount;
  if (usage.model) {
    session.model = usage.model;
  }

  recalculateIssueTotals(data, issueId);
  saveSessionMapSync(data);

  return session;
}
