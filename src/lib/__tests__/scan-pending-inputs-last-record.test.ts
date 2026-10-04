/**
 * PAN-4515 — `scanPendingInputs` must date a transcript by its last `user`/
 * `assistant` record, not by the file's modified time. Claude Code's
 * housekeeping touches a running transcript's mtime hourly without writing a
 * record, so the mtime alone used to make idle conversations look active.
 */
import { appendFileSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { scanPendingInputs } from '../agent-enrichment.js'

describe('scanPendingInputs — lastRecordAt (PAN-4515)', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scan-last-record-'))
    file = join(dir, 'session.jsonl')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('takes the last user/assistant timestamp and ignores trailing housekeeping records', async () => {
    const lines = [
      { type: 'user', timestamp: '2026-10-02T10:00:00.000Z' },
      { type: 'assistant', timestamp: '2026-10-02T10:00:05.000Z' },
      { type: 'attachment', timestamp: '2026-10-02T11:00:00.000Z' },
      { type: 'system', subtype: 'turn_duration', timestamp: '2026-10-02T11:00:00.000Z' },
      { type: 'mode' },
      { type: 'permission-mode' },
      { type: 'atis-latch' },
    ]
    writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n')

    const scan = await scanPendingInputs(file)
    expect(scan.lastRecordAt).toBe('2026-10-02T10:00:05.000Z')
  })

  it('a touch that changes the mtime does not change lastRecordAt', async () => {
    const lines = [
      { type: 'user', timestamp: '2026-10-02T10:00:00.000Z' },
      { type: 'assistant', timestamp: '2026-10-02T10:00:05.000Z' },
      { type: 'attachment', timestamp: '2026-10-02T11:00:00.000Z' },
    ]
    writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n')

    const later = new Date('2026-10-03T12:00:00.000Z')
    utimesSync(file, later, later)

    const scan = await scanPendingInputs(file)
    expect(scan.lastRecordAt).toBe('2026-10-02T10:00:05.000Z')
  })

  it('an appended user record becomes lastRecordAt', async () => {
    const lines = [
      { type: 'user', timestamp: '2026-10-02T10:00:00.000Z' },
      { type: 'assistant', timestamp: '2026-10-02T10:00:05.000Z' },
    ]
    writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n')
    appendFileSync(file, JSON.stringify({ type: 'user', timestamp: '2026-10-03T09:00:00.000Z' }) + '\n')

    const scan = await scanPendingInputs(file)
    expect(scan.lastRecordAt).toBe('2026-10-03T09:00:00.000Z')
  })

  it('no qualifying record leaves lastRecordAt absent', async () => {
    const lines = [
      '{"type":"mode"}',
      '{"type":"atis-latch"}',
      'not json',
    ]
    writeFileSync(file, lines.join('\n') + '\n')

    const scan = await scanPendingInputs(file)
    expect(scan.lastRecordAt).toBeUndefined()
  })

  it('codex and pi record shapes do not set lastRecordAt', async () => {
    const lines = [
      { timestamp: '2026-10-02T10:00:00.000Z', type: 'response_item', payload: {} },
      { type: 'message', timestamp: '2026-10-02T10:00:05.000Z', message: { role: 'user', content: [] } },
    ]
    writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n')

    const scan = await scanPendingInputs(file)
    expect(scan.lastRecordAt).toBeUndefined()
  })
})
