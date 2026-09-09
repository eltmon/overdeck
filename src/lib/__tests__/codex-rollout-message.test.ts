import { describe, it, expect } from 'vitest';
import { readCodexRolloutMessage } from '../codex-rollout-message.js';

/**
 * PAN-3781. Codex has written a rollout's user/assistant text two ways, and
 * five separate surfaces read it. This reader is the one place that knows both
 * shapes, so the shape knowledge is tested here rather than five times over.
 */
describe('readCodexRolloutMessage', () => {
  describe('legacy shape (cli >= 0.137.0)', () => {
    it('reads a user_message and an agent_message off the payload', () => {
      expect(readCodexRolloutMessage({ type: 'event_msg', payload: { type: 'user_message', message: 'fix the bug' } }))
        .toEqual({ role: 'user', text: 'fix the bug' });
      expect(readCodexRolloutMessage({ type: 'event_msg', payload: { type: 'agent_message', message: 'Done.' } }))
        .toEqual({ role: 'assistant', text: 'Done.' });
    });

    it('trims and drops whitespace-only messages', () => {
      expect(readCodexRolloutMessage({ type: 'event_msg', payload: { type: 'agent_message', message: '  spaced  ' } })?.text)
        .toBe('spaced');
      expect(readCodexRolloutMessage({ type: 'event_msg', payload: { type: 'agent_message', message: '   ' } }))
        .toBeUndefined();
    });
  });

  describe('current shape (cli >= 0.153.4 item_completed)', () => {
    it('reads a UserMessage, whose content parts are lowercase "text"', () => {
      const entry = {
        type: 'event_msg',
        payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'fix the bug' }] } },
      };
      expect(readCodexRolloutMessage(entry)).toEqual({ role: 'user', text: 'fix the bug' });
    });

    it('reads an AgentMessage, whose content parts are capitalised "Text", and keeps the phase', () => {
      const entry = {
        type: 'event_msg',
        payload: { type: 'item_completed', item: { type: 'AgentMessage', content: [{ type: 'Text', text: 'Done.' }], phase: 'final_answer' } },
      };
      expect(readCodexRolloutMessage(entry)).toEqual({ role: 'assistant', text: 'Done.', phase: 'final_answer' });
    });

    it('renders commentary the same as a final answer — narration is user-visible', () => {
      const entry = {
        type: 'event_msg',
        payload: { type: 'item_completed', item: { type: 'AgentMessage', content: [{ type: 'Text', text: 'Checking first.' }], phase: 'commentary' } },
      };
      expect(readCodexRolloutMessage(entry)?.text).toBe('Checking first.');
    });

    it('joins multiple text parts and drops non-text parts such as an attached image', () => {
      const entry = {
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          item: {
            type: 'UserMessage',
            content: [
              { type: 'text', text: 'look at ' },
              { type: 'image', image_url: 'file:///shot.png' },
              { type: 'text', text: 'this' },
            ],
          },
        },
      };
      expect(readCodexRolloutMessage(entry)).toEqual({ role: 'user', text: 'look at this' });
    });

    // Tool activity reaches every caller as response_item/custom_tool_call, so
    // returning these too would double-count each row in the work log.
    it.each(['CommandExecution', 'Reasoning', 'ImageView', 'Extension'])(
      'ignores the %s item variant',
      (variant) => {
        const entry = {
          type: 'event_msg',
          payload: { type: 'item_completed', item: { type: variant, content: [{ type: 'Text', text: 'internal' }] } },
        };
        expect(readCodexRolloutMessage(entry)).toBeUndefined();
      },
    );
  });

  it('ignores records that are not event_msg messages', () => {
    // response_item/message carries the injected context, never a visible turn.
    expect(readCodexRolloutMessage({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ctx' }] } }))
      .toBeUndefined();
    expect(readCodexRolloutMessage({ type: 'event_msg', payload: { type: 'token_count', info: {} } })).toBeUndefined();
    // Flat pre-0.137 rollouts have no event_msg wrapper; callers that still
    // support them handle that shape themselves.
    expect(readCodexRolloutMessage({ type: 'agent_message', content: 'flat' })).toBeUndefined();
  });

  it('tolerates malformed entries instead of throwing', () => {
    for (const bad of [null, undefined, 42, 'string', {}, { type: 'event_msg' }, { type: 'event_msg', payload: null }]) {
      expect(readCodexRolloutMessage(bad)).toBeUndefined();
    }
    // item_completed with a missing or non-array content list.
    expect(readCodexRolloutMessage({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage' } } }))
      .toBeUndefined();
    expect(readCodexRolloutMessage({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage', content: 'oops' } } }))
      .toBeUndefined();
  });
});
