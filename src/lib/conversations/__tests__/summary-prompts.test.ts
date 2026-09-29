import { describe, expect, it } from 'vitest';
import {
  RICH_SUMMARIZATION_PROMPT,
  RICH_UPDATE_SUMMARIZATION_PROMPT,
  SUMMARIZATION_PROMPT,
  SUMMARIZATION_SYSTEM_PROMPT,
  TURN_PREFIX_PROMPT,
  UPDATE_SUMMARIZATION_PROMPT,
  buildSummaryPrompt,
  buildSummaryUserPrompt,
  buildTurnPrefixPrompt,
} from '../summary-prompts.js';

describe('summary-prompts', () => {
  it('buildSummaryPrompt without a previous summary in standard mode is system, conversation, then the init prompt', () => {
    expect(buildSummaryPrompt('USER: hi', undefined, false)).toBe(
      `${SUMMARIZATION_SYSTEM_PROMPT}\n\n<conversation>\nUSER: hi\n</conversation>\n\n${SUMMARIZATION_PROMPT}`,
    );
  });

  it('buildSummaryPrompt in rich mode uses the rich init prompt', () => {
    expect(buildSummaryPrompt('USER: hi', undefined, true).endsWith(RICH_SUMMARIZATION_PROMPT)).toBe(true);
  });

  it('buildSummaryPrompt with a previous summary in rich mode carries <previous-summary> and ends with the rich update prompt', () => {
    const prompt = buildSummaryPrompt('USER: more', 'Earlier summary', true);
    expect(prompt).toContain('<previous-summary>\nEarlier summary\n</previous-summary>\n\n');
    expect(prompt.endsWith(RICH_UPDATE_SUMMARIZATION_PROMPT)).toBe(true);
  });

  it('buildSummaryUserPrompt is buildSummaryPrompt without the system text', () => {
    expect(buildSummaryUserPrompt('USER: more', 'Earlier', false)).toBe(
      `<conversation>\nUSER: more\n</conversation>\n\n<previous-summary>\nEarlier\n</previous-summary>\n\n${UPDATE_SUMMARIZATION_PROMPT}`,
    );
    expect(buildSummaryPrompt('x', 'y', false)).toBe(`${SUMMARIZATION_SYSTEM_PROMPT}\n\n${buildSummaryUserPrompt('x', 'y', false)}`);
  });

  it('buildTurnPrefixPrompt wraps the conversation and ends with the turn-prefix prompt', () => {
    expect(buildTurnPrefixPrompt('USER: big turn')).toBe(
      `${SUMMARIZATION_SYSTEM_PROMPT}\n\n<conversation>\nUSER: big turn\n</conversation>\n\n${TURN_PREFIX_PROMPT}`,
    );
  });
});
