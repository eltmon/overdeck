/**
 * PAN-5370: off the deck (e.g. /activity) no model picker or Home composer
 * mounts, so nothing ever asked for the settings' default model and the
 * New conversation button's second line stayed at "model pending" even
 * after settings answered. newConversationDefaults.ts now asks once at
 * module load; this proves the store and the button pick it up.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => {
  localStorage.clear() // no stored model pick, no 'pan-settings-cache'
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/settings') return Response.json({ models: { default_conversation_model: 'claude-opus-5-5' } })
    throw new Error(`Unexpected network request: ${String(input)}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock }
})

const create = vi.fn()
vi.mock('../useCreateConversation', () => ({ useCreateConversation: () => ({ create, createForAgent: vi.fn() }) }))

vi.mock('../../../shared/ModelPicker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/ModelPicker')>()
  return {
    ...actual,
    useAvailableModels: () => ({
      groups: actual.FALLBACK_GROUPS,
      compactionModel: actual.FALLBACK_COMPACTION_MODEL,
      authModes: {},
      harnessPolicy: {},
      defaultModel: 'claude-opus-5-5',
    }),
  }
})

import { NewConversationButton } from '../../NewConversationButton'
import { useNewConversationDefaults } from '../newConversationDefaults'

afterAll(() => vi.unstubAllGlobals())

beforeEach(() => {
  create.mockClear()
})

describe('newConversationDefaults module-load default (PAN-5370)', () => {
  it('takes the settings default model without a picker mounting (PAN-5370)', async () => {
    await waitFor(() => expect(useNewConversationDefaults.getState().model).toBe('claude-opus-5-5'))
    expect(settings.fetchMock).toHaveBeenCalledWith('/api/settings')

    render(<NewConversationButton selectedProject="proj" collapsed={false} />)
    expect(screen.getByTestId('new-conversation-summary')).toHaveTextContent('Opus 5.5')
    expect(screen.getByTestId('new-conversation-summary')).not.toHaveTextContent('model pending')
  })
})
