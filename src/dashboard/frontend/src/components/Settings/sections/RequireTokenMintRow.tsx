import { Toggle } from '../Shared/Toggle';
import { type SettingsConfig } from '../types';

interface RequireTokenMintRowProps {
  formData: SettingsConfig;
  onSettingsChange: (next: SettingsConfig, opts?: { debounce?: boolean }) => void;
}

export function RequireTokenMintRow({ formData, onSettingsChange }: RequireTokenMintRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors mb-2">
      <div className="min-w-0">
        <span className="text-sm font-medium text-foreground">Require a token to sign in</span>
        <p className="text-xs text-muted-foreground mt-0.5">
          Turn this on when a local reverse proxy (Tailscale Serve, cloudflared) forwards outside
          traffic. Browsers that already have a session keep working; a new browser on this
          machine then needs the <code>#overdeck_token=</code> link or pairing to sign in.
        </p>
      </div>
      <Toggle
        checked={formData.dashboard?.require_token_mint ?? false}
        onChange={(checked) => onSettingsChange({
          ...formData,
          dashboard: { ...formData.dashboard, require_token_mint: checked },
        })}
      />
    </div>
  );
}
