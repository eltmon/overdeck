/**
 * Renders a Settings → Anywhere dialog opened from outside Settings (PAN-4869):
 * the command palette calls `openAnywhereDialog`, and this host — mounted once
 * in main.tsx — renders the same dialog component the Settings page renders,
 * over whatever page the operator is on. The Tailscale dialog is gated here:
 * only a root session (a browser on this machine) may open it (D7). Link a
 * machine gets the agent request id a machine-link card opened it with
 * (PAN-4942 D-11).
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAnywhereDialogStore, openAnywhereDialog } from './anywhereDialogStore';
import { ANYWHERE_STATUS_QUERY_KEY, loadAnywhereStatus } from './anywhereApi';
import { LinkMachineDialog } from './LinkMachineDialog';
import { AddFlyMachineDialog } from './AddFlyMachineDialog';
import { AddSshMachineDialog } from './AddSshMachineDialog';
import { SetUpPhoneDialog } from './SetUpPhoneDialog';
import { PairDeviceDialog } from './PairDeviceDialog';
import { TailscaleSetupDialog } from './TailscaleSetupDialog';

export function AnywhereDialogHost() {
  const dialog = useAnywhereDialogStore((s) => s.dialog);
  const close = useAnywhereDialogStore((s) => s.close);
  const agentRequestId = useAnywhereDialogStore((s) => s.agentRequestId);
  const wantsTailscale = dialog === 'tailscale-setup';
  const { data: status, isError } = useQuery({
    queryKey: ANYWHERE_STATUS_QUERY_KEY,
    queryFn: loadAnywhereStatus,
    enabled: wantsTailscale,
  });
  const tailscaleAllowed = status?.viewer?.kind === 'root-session';

  useEffect(() => {
    if (!wantsTailscale) return;
    if (isError || (status && !tailscaleAllowed)) {
      toast.info('Tailscale can be set up only from a browser on this machine.');
      close();
    }
  }, [wantsTailscale, isError, status, tailscaleAllowed, close]);

  return (
    <>
      <LinkMachineDialog open={dialog === 'link-machine'} onClose={close} agentRequestId={agentRequestId} />
      <AddFlyMachineDialog open={dialog === 'add-fly-machine'} onClose={close} />
      <AddSshMachineDialog open={dialog === 'add-ssh-machine'} onClose={close} />
      <SetUpPhoneDialog open={dialog === 'set-up-phone'} onClose={close} />
      <PairDeviceDialog open={dialog === 'pair-device'} onClose={close} />
      <TailscaleSetupDialog
        open={wantsTailscale && tailscaleAllowed}
        onClose={close}
        onPair={() => openAnywhereDialog('pair-device')}
      />
    </>
  );
}
