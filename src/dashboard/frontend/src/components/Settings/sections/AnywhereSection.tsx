import { useState } from 'react';

import { requestSettingsSection } from '../../../lib/settingsSection';
import { SettingsSection } from '../primitives/SettingsSection';
import { AnywhereStatusCard } from '../anywhere/AnywhereStatusCard';
import type { AnywhereAction } from '../anywhere/anywhereApi';
import { DevicesPanel } from '../anywhere/DevicesPanel';
import { PairDeviceDialog } from '../anywhere/PairDeviceDialog';

interface AnywhereSectionProps {
  /** Controlled open state for the pair dialog, so the status card can open it. */
  pairDialogOpen?: boolean;
  onPairDialogChange?: (open: boolean) => void;
}

/** Settings → Anywhere: reach this machine from other devices (PAN-4445 FR-8). */
export function AnywhereSection({ pairDialogOpen, onPairDialogChange }: AnywhereSectionProps = {}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = pairDialogOpen ?? localOpen;
  const setOpen = (next: boolean) => {
    setLocalOpen(next);
    onPairDialogChange?.(next);
  };
  const handleAction = (action: AnywhereAction) => {
    if (action.kind === 'pair-dialog') setOpen(true);
    else if (action.kind === 'settings-section') requestSettingsSection(action.section);
  };

  return (
    <SettingsSection
      id="anywhere"
      title="Anywhere"
      description="Reach this machine from your other devices"
      actions={(
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Pair a device
        </button>
      )}
    >
      <div className="space-y-4">
        <AnywhereStatusCard onAction={handleAction} />
        <DevicesPanel />
      </div>
      <PairDeviceDialog open={open} onClose={() => setOpen(false)} />
    </SettingsSection>
  );
}
