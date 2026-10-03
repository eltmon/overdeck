/**
 * PAN-4254 WI-11 checkpoint: the sidebar's model/effort/retrospective trio,
 * extracted from CommandDeck/index.tsx to keep it under its file-size cap.
 */
import { ModelPicker, MODEL_EFFORT_SUPPORT, saveStoredHarness, saveStoredModel } from '../chat/ModelPicker';
import { EffortPicker, type EffortLevel } from '../chat/EffortPicker';
import { pickerEffortLevels } from '../shared/ModelPicker';
import type { Harness } from '../shared/ModelPicker';
import { RetrospectiveButton } from './RetrospectiveButton';

export interface NewConversationPickersProps {
  model: string;
  onModelChange: (model: string) => void;
  harness: Harness;
  onHarnessChange: (harness: Harness) => void;
  effort: EffortLevel;
  onEffortChange: (effort: EffortLevel) => void;
}

export function NewConversationPickers({ model, onModelChange, harness, onHarnessChange, effort, onEffortChange }: NewConversationPickersProps) {
  return (
    <>
      <ModelPicker
        value={model}
        onChange={(modelId) => {
          onModelChange(modelId);
          saveStoredModel(modelId);
        }}
        harness={harness} followProviderDefault
        onHarnessChange={(nextHarness) => {
          onHarnessChange(nextHarness);
          saveStoredHarness(nextHarness);
        }}
      />
      <EffortPicker
        value={effort}
        onChange={onEffortChange}
        availableLevels={pickerEffortLevels(model) ?? MODEL_EFFORT_SUPPORT[model as keyof typeof MODEL_EFFORT_SUPPORT]}
      />
      <RetrospectiveButton model={model} harness={harness} />
    </>
  );
}
