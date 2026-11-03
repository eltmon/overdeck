/**
 * useQrScanner — rear-camera QR scanning with a lazily loaded `jsqr` (PAN-2355 FR-6). Moved out of
 * MobilePairScreen so the phone app's pair screen reuses it (PAN-4837 WI-12).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** HTMLMediaElement.HAVE_CURRENT_DATA: a frame is available to draw. */
const HAVE_CURRENT_DATA = 2;
const CAMERA_UNAVAILABLE = 'Camera is not available. Paste the pairing link instead.';

type Decode = (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null;

export function useQrScanner(onCode: (text: string) => boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const release = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    release();
    setScanning(false);
  }, [release]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      release();
    };
  }, [release]);

  const start = useCallback(async () => {
    setCameraError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia unavailable');
      const [stream, jsqr] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }),
        import('jsqr'),
      ]);
      if (!mountedRef.current) {
        // The screen closed while the permission prompt was open.
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const decode: Decode = (data, width, height) => jsqr.default(data, width, height, { inversionAttempts: 'dontInvert' });
      streamRef.current = stream;
      setScanning(true);
      const video = videoRef.current;
      if (!video) throw new Error('video element missing');
      video.srcObject = stream;
      await video.play();
      const tick = () => {
        const canvas = canvasRef.current;
        if (!streamRef.current || !canvas) return;
        if (video.readyState >= HAVE_CURRENT_DATA && video.videoWidth > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = decode(image.data, image.width, image.height);
            if (code && onCode(code.data)) {
              stop();
              return;
            }
          }
        }
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch {
      stop();
      setCameraError(CAMERA_UNAVAILABLE);
    }
  }, [onCode, stop]);

  return { videoRef, canvasRef, scanning, cameraError, start, stop };
}
