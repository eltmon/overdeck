/**
 * The phone step of Set up Tailscale (PAN-1254 FR-8): a QR code for the
 * Tailscale app download, the account to sign in with, and a shortcut to
 * pair the phone with this dashboard.
 */
import { QrImage } from './QrImage';

export const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download';

const SECONDARY_BUTTON = 'shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors';

export function TailscalePhoneQr({ loginName, onPair }: { loginName: string | null; onPair: () => void }) {
  return (
    <div className="flex items-start gap-4" data-component="tailscale-phone-qr">
      <QrImage link={TAILSCALE_DOWNLOAD_URL} alt="Tailscale app download QR code" />
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Scan to install Tailscale on your phone, then sign in as {loginName ?? 'the same account as this machine'}.
        </p>
        <button type="button" className={SECONDARY_BUTTON} onClick={onPair}>Pair a device</button>
      </div>
    </div>
  );
}
