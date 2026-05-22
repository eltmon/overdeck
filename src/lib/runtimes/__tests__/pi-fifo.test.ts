import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync, writeFileSync, existsSync, readFileSync, openSync, closeSync, createReadStream, constants as fsConstants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createPiFifo,
  destroyPiFifoSync,
  writePiCommandSync,
  piFifoPaths,
  PiNotReady,
} from '../pi-fifo.js'

function makeFakeHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'pan-pi-fifo-'))
  return {
    home,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  }
}

function isFifo(path: string): boolean {
  try {
    return statSync(path).isFIFO()
  } catch {
    return false
  }
}

function writeReady(home: string, agentId: string): void {
  const paths = piFifoPaths(agentId, home)
  writeFileSync(paths.readyPath, '{}')
}

describe('createPiFifo', () => {
  let h: ReturnType<typeof makeFakeHome>
  beforeEach(() => { h = makeFakeHome() })
  afterEach(() => h.cleanup())

  it('creates a fifo at ~/.panopticon/agents/<id>/rpc.in with mode 0600 (AC1)', async () => {
    const path = await Effect.runPromise(createPiFifo('agent-x', h.home))
    expect(path).toBe(piFifoPaths('agent-x', h.home).fifoPath)
    expect(isFifo(path)).toBe(true)
    const mode = statSync(path).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('is idempotent — replaces an existing fifo (AC1)', async () => {
    const path = await Effect.runPromise(createPiFifo('agent-x', h.home))
    expect(isFifo(path)).toBe(true)
    // Recreate — should not throw and the result must still be a fifo.
    const path2 = await Effect.runPromise(createPiFifo('agent-x', h.home))
    expect(path2).toBe(path)
    expect(isFifo(path2)).toBe(true)
  })

  it('replaces a stale regular file at the fifo path (AC1)', async () => {
    const paths = piFifoPaths('agent-x', h.home)
    // Pre-create the agent dir and put a regular file where the fifo should go.
    await Effect.runPromise(createPiFifo('agent-x', h.home))
    destroyPiFifoSync('agent-x', h.home)
    writeFileSync(paths.fifoPath, 'leftover')
    expect(isFifo(paths.fifoPath)).toBe(false)
    await Effect.runPromise(createPiFifo('agent-x', h.home))
    expect(isFifo(paths.fifoPath)).toBe(true)
  })
})

describe('destroyPiFifo', () => {
  let h: ReturnType<typeof makeFakeHome>
  beforeEach(() => { h = makeFakeHome() })
  afterEach(() => h.cleanup())

  it('unlinks the fifo (AC2)', async () => {
    await Effect.runPromise(createPiFifo('agent-x', h.home))
    const paths = piFifoPaths('agent-x', h.home)
    expect(existsSync(paths.fifoPath)).toBe(true)
    destroyPiFifoSync('agent-x', h.home)
    expect(existsSync(paths.fifoPath)).toBe(false)
  })

  it('is a no-op when the fifo does not exist (AC2)', () => {
    expect(() => destroyPiFifoSync('agent-x', h.home)).not.toThrow()
  })
})

describe('writePiCommand', () => {
  let h: ReturnType<typeof makeFakeHome>
  beforeEach(() => { h = makeFakeHome() })
  afterEach(() => h.cleanup())

  it('throws PiNotReady (without blocking) when ready.json is missing (AC4)', async () => {
    await Effect.runPromise(createPiFifo('agent-x', h.home))
    expect(() => writePiCommandSync('agent-x', { kind: 'ping' }, h.home)).toThrow(PiNotReady)
  })

  it('throws PiNotReady when no reader is connected (Pi exited)', async () => {
    await Effect.runPromise(createPiFifo('agent-x', h.home))
    writeReady(h.home, 'agent-x')
    // No reader; O_WRONLY|O_NONBLOCK should fail with ENXIO -> PiNotReady.
    expect(() => writePiCommandSync('agent-x', { kind: 'ping' }, h.home)).toThrow(PiNotReady)
  })

  it('writes one JSONL line through the fifo to a pre-attached reader (AC3)', async () => {
    const fifo = await Effect.runPromise(createPiFifo('agent-x', h.home))
    writeReady(h.home, 'agent-x')

    // Open a long-lived reader on the fifo. We open with O_RDWR so the fd
    // stays valid across writer lifecycles (no EOF when the writer closes).
    // This mirrors how Pi keeps stdin open for the duration of its session.
    const readerFd = openSync(fifo, fsConstants.O_RDWR)
    const reader = createReadStream('', { fd: readerFd })
    const chunks: Buffer[] = []
    reader.on('data', (chunk: string | Buffer) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    })

    writePiCommandSync('agent-x', { kind: 'prompt', text: 'hello' }, h.home)

    // Wait for the byte to round-trip through the kernel pipe.
    await waitFor(() => Buffer.concat(chunks).toString('utf8').includes('\n'), 2_000)

    expect(Buffer.concat(chunks).toString('utf8')).toBe(`{"kind":"prompt","text":"hello"}\n`)

    reader.destroy()
  })
})

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) return
    await new Promise(r => setTimeout(r, 25))
  }
  throw new Error('waitFor timed out')
}
