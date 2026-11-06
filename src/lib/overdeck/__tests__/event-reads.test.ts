import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../tests/helpers/overdeck-test-db.js';
import {
  readLatestAgentClaudeSessionIdEvent,
  readRecordedAgentStopAt,
} from '../event-reads.js';

function insertEvent(
  odb: OverdeckTestDb,
  type: 'agent.created' | 'agent.model_set' | 'agent.started' | 'agent.stopped' | 'agent.status_changed' | 'agent.heartbeat_dead',
  sequenceTimestamp: number,
  payload: Record<string, unknown>,
): void {
  odb.raw().prepare(`
    INSERT INTO events (type, timestamp, payload)
    VALUES (?, ?, ?)
  `).run(type, sequenceTimestamp, JSON.stringify(payload));
}

function insertModelSet(
  odb: OverdeckTestDb,
  sequenceTimestamp: number,
  payload: Record<string, unknown>,
): void {
  insertEvent(odb, 'agent.model_set', sequenceTimestamp, payload);
}

describe('agent event read door', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => {
    odb = setupOverdeckTestDb();
  }, 20_000);

  afterEach(() => {
    teardownOverdeckTestDb(odb);
  });

  it('returns the latest retained session id for one agent', () => {
    insertModelSet(odb, 1, { agentId: 'agent-min-839', claudeSessionId: 'older-session' });
    insertModelSet(odb, 2, { agentId: 'agent-other', claudeSessionId: 'other-session' });
    insertModelSet(odb, 3, { agentId: 'agent-min-839', model: 'claude-opus-5' });
    insertModelSet(odb, 4, { agentId: 'agent-min-839', claudeSessionId: 'newer-session' });

    expect(readLatestAgentClaudeSessionIdEvent('agent-min-839')).toBe('newer-session');
  });

  it('honors an explicit session clear instead of resurrecting an older id', () => {
    insertModelSet(odb, 1, { agentId: 'agent-min-839', claudeSessionId: 'older-session' });
    insertModelSet(odb, 2, { agentId: 'agent-min-839', claudeSessionId: null });

    expect(readLatestAgentClaudeSessionIdEvent('agent-min-839')).toBeNull();
  });


  // PAN-5074: planning finalize records the stop only as an event.
  describe('readRecordedAgentStopAt', () => {
    const STARTED = '2026-11-05T23:04:55.297Z';
    const FINALIZED = Date.parse('2026-11-05T23:26:24.664Z');
    const planning = { id: 'planning-pan-5069', startedAt: STARTED };

    function stopped(at: number, agentId = 'planning-pan-5069'): void {
      insertEvent(odb, 'agent.status_changed', at, { agentId, status: 'stopped', previousStatus: 'running' });
    }

    it('returns the finalize stop of a planning agent', () => {
      stopped(FINALIZED);
      expect(readRecordedAgentStopAt(planning)).toBe(FINALIZED);
    });

    it('returns null when nothing recorded a stop', () => {
      insertEvent(odb, 'agent.started', Date.parse(STARTED), { agentId: 'planning-pan-5069' });
      expect(readRecordedAgentStopAt(planning)).toBeNull();
      expect(readRecordedAgentStopAt({ id: 'agent-none', startedAt: STARTED })).toBeNull();
    });

    it('ignores a stop older than the launch generation', () => {
      stopped(FINALIZED);
      expect(readRecordedAgentStopAt({ ...planning, lastResumeAt: '2026-11-05T23:40:00.000Z' })).toBeNull();
      expect(readRecordedAgentStopAt({ ...planning, startedAt: '2026-11-05T23:40:00.000Z' })).toBeNull();
    });

    it('ignores a stop followed by a new start', () => {
      stopped(FINALIZED);
      insertEvent(odb, 'agent.started', FINALIZED + 60_000, { agentId: 'planning-pan-5069' });
      expect(readRecordedAgentStopAt(planning)).toBeNull();
    });

    it("does not count deacon-lite's own death report as a recorded stop", () => {
      insertEvent(odb, 'agent.started', Date.parse(STARTED), { agentId: 'planning-pan-5069' });
      insertEvent(odb, 'agent.heartbeat_dead', FINALIZED, { agentId: 'planning-pan-5069' });
      stopped(FINALIZED);
      expect(readRecordedAgentStopAt(planning)).toBeNull();
    });

    it("reads past deacon-lite's death reports to an earlier finalize stop", () => {
      stopped(FINALIZED);
      for (const offset of [40_000, 100_000]) {
        insertEvent(odb, 'agent.heartbeat_dead', FINALIZED + offset, { agentId: 'planning-pan-5069' });
        stopped(FINALIZED + offset);
      }
      expect(readRecordedAgentStopAt(planning)).toBe(FINALIZED);
    });

    // After a deacon restart: the earlier report of this launch covers it.
    it('counts an earlier death report only when asked, and not before notBefore', () => {
      const REPORTED = Date.parse('2026-11-05T23:50:00.000Z');
      insertEvent(odb, 'agent.heartbeat_dead', REPORTED, { agentId: 'planning-pan-5069' });
      stopped(REPORTED);
      expect(readRecordedAgentStopAt(planning)).toBeNull();
      expect(readRecordedAgentStopAt(planning, { reports: {} })).toBe(REPORTED);
      expect(readRecordedAgentStopAt(planning, { reports: { notBefore: REPORTED + 60_000 } })).toBeNull();
      expect(readRecordedAgentStopAt({ ...planning, lastResumeAt: '2026-11-05T23:55:00.000Z' }, { reports: {} })).toBeNull();
    });

    it("skips the supervisor's exit observation and other agents' events", () => {
      stopped(FINALIZED);
      insertEvent(odb, 'agent.stopped', FINALIZED + 1_000, { agentId: 'planning-pan-5069' });
      insertEvent(odb, 'agent.started', FINALIZED + 2_000, { agentId: 'planning-pan-5070' });
      expect(readRecordedAgentStopAt(planning)).toBe(FINALIZED);
    });

    it('reads only events before beforeSequence', () => {
      stopped(FINALIZED);
      insertEvent(odb, 'agent.heartbeat_dead', FINALIZED + 40_000, { agentId: 'planning-pan-5069' });
      stopped(FINALIZED + 40_000);
      const heartbeat = odb.raw().prepare(`SELECT sequence FROM events WHERE type = 'agent.heartbeat_dead'`).get() as { sequence: number };
      expect(readRecordedAgentStopAt(planning, { beforeSequence: heartbeat.sequence })).toBe(FINALIZED);
      expect(readRecordedAgentStopAt(planning, { beforeSequence: 1 })).toBeNull();
    });
  });
});
