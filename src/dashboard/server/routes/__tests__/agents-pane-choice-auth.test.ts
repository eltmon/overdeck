import { Effect } from 'effect'
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const answerSessionPaneChoice = vi.hoisted(() => vi.fn())

vi.mock('../../../../lib/session-pane-choice.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/session-pane-choice.js')>()
  return {
    ...actual,
    answerSessionPaneChoice,
  }
})

import { postAgentPaneChoiceRoute } from '../agents/permissions.js'

function decodeJsonResponse(response: { body: unknown }): Record<string, unknown> {
  const payload = response.body as { body: Uint8Array } | null
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}'
  return JSON.parse(text) as Record<string, unknown>
}

async function postPaneChoice(origin: string) {
  const request = HttpServerRequest.fromWeb(new Request(
    'http://localhost/api/agents/agent-pan-3228/pane-choice',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: JSON.stringify({ selectedIndex: 0, signature: 'sig-1' }),
    },
  ))

  return Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(postAgentPaneChoiceRoute), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ),
    ),
  )
}

describe('POST /api/agents/:id/pane-choice authentication', () => {
  beforeEach(() => {
    answerSessionPaneChoice.mockReset()
  })

  it('rejects an untrusted origin before invoking the answer core', async () => {
    const response = await postPaneChoice('https://evil.example')

    expect(response.status).toBe(403)
    expect(decodeJsonResponse(response)).toEqual({ error: 'Invalid origin' })
    expect(answerSessionPaneChoice).not.toHaveBeenCalled()
  })
})
