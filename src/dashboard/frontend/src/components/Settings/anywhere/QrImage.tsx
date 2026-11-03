/**
 * A QR code for a link, rendered as a data-URL image (PAN-1254 D-15). Shared
 * by the pairing dialog and the Tailscale setup dialog.
 */
import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

export function QrImage({ link, alt }: { link: string; alt: string }) {
  const src = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    return qr.createDataURL(6, 8);
  }, [link]);
  return <img alt={alt} src={src} data-qr-value={link} className="rounded-md bg-white p-1 w-48 h-48" />;
}
