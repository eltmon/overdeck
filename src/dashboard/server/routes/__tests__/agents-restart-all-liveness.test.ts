import { Effect } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EventStoreService } from '../../services/domain-services.js'

const mocks = vi.hoisted(() => ({
  listRunningAgents: vi.fn(),
  restartAgent: vi.fn(),
  listLiveAgentIds: vi.fn(),
}))

vi.mock('../../../../lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/agents.js')>()
  return {
    ...actual,
    listRunningAgents: () => Effect.sync(() => mocks.listRunningAgents()),
    restartAgent: mocks.restartAgent,
  }
})

// Fake terminal backend: the live inventory restart-all reads (#4109).
vi.mock('../../../../lib/terminal-backends/inventory.js', () => ({
  listLiveAgentIds: mocks.listLiveAgentIds,
}))

import { postAgentsRestartAllRoute } from '../agents/lifecycle-restart.js'

async function postRestartAll(): Promise<{ status: number; body: any }> {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/agents/restart-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }))
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(postAgentsRestartAllRoute), (app) =>
        Effect.provideService(
          Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
          EventStoreService,
          { appendAsync: () => Effect.succeed(1) } as any,
        ),
      ),
    ),
  )
  const web = HttpServerResponse.toWeb(response)
  return { status: web.status, body: await web.json() }
}

// A Herdr work agent: the tmux-only flag is false while its pane is live.
const herdrAgent = {
  id: 'agent-pan-4109',
  issueId: 'PAN-4109',
  model: 'claude-sonnet-5',
  role: 'work',
  status: 'running',
  sessionId: 'session-1',
  tmuxActive: false,
}

describe('POST /api/agents/restart-all liveness (#4109)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listRunningAgents.mockReturnValue([herdrAgent])
    mocks.restartAgent.mockResolvedValue({ success: true })
  })

  it('restarts a live Herdr agent whose tmuxActive flag is false', async () => {
    mocks.listLiveAgentIds.mockResolvedValue(new Set(['agent-pan-4109']))

    const { status, body } = await postRestartAll()

    expect(status).toBe(200)
    expect(mocks.restartAgent).toHaveBeenCalledWith('agent-pan-4109', expect.anything())
    expect(body.restarted).toBe(1)
  })

  it('skips a row that is absent from the backend inventory', async () => {
    mocks.listLiveAgentIds.mockResolvedValue(new Set())

    const { body } = await postRestartAll()

    expect(mocks.restartAgent).not.toHaveBeenCalled()
    expect(body.total).toBe(0)
  })

  it('restarts nothing and answers 503 when the backend inventory is unreadable', async () => {
    mocks.listLiveAgentIds.mockResolvedValue(null)

    const { status } = await postRestartAll()

    expect(status).toBe(503)
    expect(mocks.restartAgent).not.toHaveBeenCalled()
  })
})
