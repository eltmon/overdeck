import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createGitStatusScheduler } from '../git-status-scheduler'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function setup() {
  const run = vi.fn(async () => {})
  const scheduler = createGitStatusScheduler({ run })
  return { run, scheduler }
}

describe('createGitStatusScheduler', () => {
  it('collapses three signals 50 ms apart into one run 125 ms after the last', async () => {
    const { run, scheduler } = setup()
    scheduler.signal()
    await vi.advanceTimersByTimeAsync(50)
    scheduler.signal()
    await vi.advanceTimersByTimeAsync(50)
    scheduler.signal()
    await vi.advanceTimersByTimeAsync(124)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
    scheduler.dispose()
  })

  it('waits until 3 s after the previous run for a signal 1 s after it', async () => {
    const { run, scheduler } = setup()
    scheduler.runNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    scheduler.signal()
    await vi.advanceTimersByTimeAsync(1999)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
    scheduler.dispose()
  })

  it('runs the safety refresh at 60 s while active, and not while inactive', async () => {
    const { run, scheduler } = setup()
    scheduler.runNow()
    await vi.advanceTimersByTimeAsync(0)
    scheduler.setActive(true)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)

    scheduler.setActive(false)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(run).toHaveBeenCalledTimes(2)
    scheduler.dispose()
  })

  it('makes no safety run when never activated', async () => {
    const { run, scheduler } = setup()
    scheduler.runNow()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(run).toHaveBeenCalledTimes(1)
    scheduler.dispose()
  })

  it('cancels pending runs on dispose', async () => {
    const { run, scheduler } = setup()
    scheduler.setActive(true)
    scheduler.signal()
    scheduler.dispose()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(run).not.toHaveBeenCalled()
  })

  it('runs once more after a run that a signal overlapped', async () => {
    let finish: () => void = () => {}
    const run = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const scheduler = createGitStatusScheduler({ run })
    scheduler.runNow()
    await vi.advanceTimersByTimeAsync(0)
    scheduler.runNow()
    expect(run).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(3000)
    expect(run).toHaveBeenCalledTimes(2)
    scheduler.dispose()
  })
})
