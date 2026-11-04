import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { requestSettingsSection } from '../../../lib/settingsSection';
import { SettingsSection } from '../primitives/SettingsSection';
import { AccessTokensPanel } from '../anywhere/AccessTokensPanel';
import { BotsPanel } from '../anywhere/BotsPanel';
import { AnywhereStatusCard } from '../anywhere/AnywhereStatusCard';
import { ANYWHERE_STATUS_QUERY_KEY, loadAnywhereStatus, type AnywhereAction } from '../anywhere/anywhereApi';
import { DevicesPanel } from '../anywhere/DevicesPanel';
import { DirectoryPanel } from '../anywhere/DirectoryPanel';
import { FleetVersionsPanel } from '../anywhere/FleetVersionsPanel';
import { MachinesPanel } from '../anywhere/MachinesPanel';
import { McpUrlDialog } from '../anywhere/McpUrlDialog';
import { PairDeviceDialog } from '../anywhere/PairDeviceDialog';
import { TriggersPanel } from '../anywhere/TriggersPanel';
import { SetUpPhoneDialog } from '../anywhere/SetUpPhoneDialog';
import { PushPanel } from '../anywhere/PushPanel';
import { TailscalePeersPanel } from '../anywhere/TailscalePeersPanel';
import { TailscaleSetupDialog } from '../anywhere/TailscaleSetupDialog';

interface AnywhereSectionProps {
  /** Controlled open state for the pair dialog, so the status card can open it. */
  pairDialogOpen?: boolean;
  onPairDialogChange?: (open: boolean) => void;
}

/** Settings → Anywhere: reach this machine from other devices (PAN-4445 FR-8). */
export function AnywhereSection({ pairDialogOpen, onPairDialogChange }: AnywhereSectionProps = {}) {
  const [localOpen, setLocalOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const open = pairDialogOpen ?? localOpen;
  const setOpen = (next: boolean) => {
    setLocalOpen(next);
    onPairDialogChange?.(next);
  };
  const [tailscaleOpen, setTailscaleOpen] = useState(false);
  // Only this machine's browser may change Tailscale (PAN-1254 D-4); a paired device's POSTs get 403.
  const { data: status } = useQuery({ queryKey: ANYWHERE_STATUS_QUERY_KEY, queryFn: loadAnywhereStatus });
  const canSetUpTailscale = status?.viewer.kind === 'root-session';
  const handleAction = (action: AnywhereAction) => {
    if (action.kind === 'pair-dialog') setOpen(true);
    else if (action.kind === 'settings-section') requestSettingsSection(action.section);
    else if (action.kind === 'tailscale-setup') setTailscaleOpen(true);
  };

  return (
    <SettingsSection
      id="anywhere"
      title="Anywhere"
      description="Reach this machine from your other devices"
      actions={(
        <div className="flex items-center gap-2">
          {canSetUpTailscale && (
            <button
              type="button"
              onClick={() => setTailscaleOpen(true)}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted/50 transition-colors"
            >
              Set up Tailscale
            </button>
          )}
          <button
            type="button"
            onClick={() => setMcpOpen(true)}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted/50 transition-colors"
          >
            Copy MCP URL
          </button>
          <button
            type="button"
            onClick={() => setPhoneOpen(true)}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted/50 transition-colors"
          >
            Set up a phone
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Pair a device
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <AnywhereStatusCard onAction={handleAction} />
        <DevicesPanel />
        <MachinesPanel />
        <DirectoryPanel />
        <FleetVersionsPanel />
        {status?.tailscale?.nextStep === 'ready' && <TailscalePeersPanel />}
        <TriggersPanel />
        <AccessTokensPanel />
        <BotsPanel />
        <PushPanel />
      </div>
      <PairDeviceDialog open={open} onClose={() => setOpen(false)} />
      <TailscaleSetupDialog
        open={tailscaleOpen}
        onClose={() => setTailscaleOpen(false)}
        onPair={() => {
          setTailscaleOpen(false);
          setOpen(true);
        }}
      />
      <McpUrlDialog open={mcpOpen} onClose={() => setMcpOpen(false)} />
      <SetUpPhoneDialog open={phoneOpen} onClose={() => setPhoneOpen(false)} />
    </SettingsSection>
  );
}
