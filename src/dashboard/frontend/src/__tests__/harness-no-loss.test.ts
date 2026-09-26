/**
 * Frontend companion to the harness no-loss audit (PAN-3668 WI-22, FR-19): every
 * canonical harness has a brand and a picker option, the Prime Agent harness row has
 * its label, and each hand-copied frontend harness list names prime-agent.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { KNOWN_HARNESSES } from '@overdeck/contracts';
import { HARNESS_BRANDS } from '../components/shared/branding';
import { HARNESS_OPTIONS } from '../components/shared/ModelPicker/ModelPicker';
import { HARNESS_ROW_LABELS } from '../components/shared/ModelPicker/harnessRows';

const SRC = join(import.meta.dirname, '..');

const FRONTEND_LITERAL_FILES = [
  'types.ts',
  'components/Settings/types.ts',
  'components/Settings/RolesPanel.tsx',
  'components/Settings/sections/CrewRow.tsx',
  'components/Settings/sections/TieredExecutionSection.tsx',
  'components/Settings/sections/ProviderManagementSection.tsx',
  'components/chat/ModelPicker.tsx',
  'components/PlanDialog.tsx',
  'components/CommandDeck/ConversationList.tsx',
  'components/CommandDeck/ConversationRow.tsx',
  'components/CommandDeck/ForkModal.tsx',
  'components/CommandDeck/useConversationMutations.ts',
  'components/sessionFeed/useConversationFeed.ts',
  'components/sessionFeed/ConversationFeedCard.tsx',
  'components/context/ContextPage.tsx',
  'hooks/useSwitchModel.ts',
] as const;

describe('frontend harness no-loss audit (PAN-3668 WI-22)', () => {
  it.each([...KNOWN_HARNESSES])('%s has a brand and a picker option', (harness) => {
    expect(HARNESS_BRANDS[harness as keyof typeof HARNESS_BRANDS]).toBeDefined();
    expect(HARNESS_OPTIONS.map((option) => option.id)).toContain(harness);
  });

  it('labels the Prime Agent harness row', () => {
    expect(HARNESS_ROW_LABELS['prime-agent']).toBe('Prime Agent');
  });

  it.each(FRONTEND_LITERAL_FILES)('%s names prime-agent', (file) => {
    expect(readFileSync(join(SRC, file), 'utf8')).toContain("'prime-agent'");
  });
});
