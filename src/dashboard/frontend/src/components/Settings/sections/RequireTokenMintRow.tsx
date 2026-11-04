import { useQuery } from '@tanstack/react-query';

import { ANYWHERE_STATUS_QUERY_KEY, loadAnywhereStatus } from '../anywhere/anywhereApi';
import { Toggle } from '../Shared/Toggle';
import { type SettingsConfig } from '../types';

interface RequireTokenMintRowProps {
  formData: SettingsConfig;
  onSettingsChange: (next: SettingsConfig, opts?: { debounce?: boolean }) => void;
}

const REASON_TEXT: Record<string, string> = {
  'trusted-address': 'a trusted remote address',
  'paired-device': 'a paired device',
  'machine-link': 'a machine link',
};

/** `a paired device`, `a paired device and a machine link`, `a trusted remote address, a paired device and a machine link`. */
export function describeAutoReasons(reasons: string[]): string {
  const parts = reasons.map((reason) => REASON_TEXT[reason] ?? reason);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function RequireTokenMintRow({ formData, onSettingsChange }: RequireTokenMintRowProps) {
  // PAN-4645 D-4645-12: with any remote access the value is on by itself and
  // the toggle cannot turn it off; the status says why.
  const { data: status } = useQuery({ queryKey: ANYWHERE_STATUS_QUERY_KEY, queryFn: loadAnywhereStatus });
  const autoReasons = status?.tokenMint?.autoReasons ?? [];
  const forcedOn = autoReasons.length > 0;
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors mb-2">
      <div className="min-w-0">
        <span className="text-sm font-medium text-foreground">Require a token to sign in</span>
        <p className="text-xs text-muted-foreground mt-0.5">
          Turn this on when a local reverse proxy (Tailscale Serve, cloudflared) forwards outside
          traffic. Browsers that already have a session keep working; a new browser on this
          machine then needs the <code>#overdeck_token=</code> link or pairing to sign in.
        </p>
        {forcedOn && (
          <p className="text-xs text-muted-foreground mt-1" data-testid="require-token-mint-auto">
            On automatically because this machine has {describeAutoReasons(autoReasons)}.
          </p>
        )}
      </div>
      <Toggle
        checked={forcedOn || (formData.dashboard?.require_token_mint ?? false)}
        disabled={forcedOn}
        onChange={(checked) => onSettingsChange({
          ...formData,
          dashboard: { ...formData.dashboard, require_token_mint: checked },
        })}
      />
    </div>
  );
}
