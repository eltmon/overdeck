// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: apps/web/src/components/files/decodeImagePreview.ts @ 2d8a843e6b
// HEIF decoding is not ported (heic-to is LGPL, PAN-5188 D-2); only TIFF reaches the worker.
import { readBinaryPreview } from "../shared/readBounded";

export async function decodeImagePreview(src: string, signal: AbortSignal) {
  const worker = new Worker(new URL("./imageDecode.worker.ts", import.meta.url), {
    type: "module",
  });
  const controller = new AbortController();
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const fail = (message: string) => reject(new Error(message));
      const abort = () => fail("Image decoding cancelled.");
      signal.addEventListener("abort", abort, { signal: controller.signal });
      if (signal.aborted) return abort();
      const timer = setTimeout(() => fail("This image took too long to decode."), 30_000);
      controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
      worker.addEventListener("error", () => fail("Could not load the image decoder."));
      worker.addEventListener("message", (event: MessageEvent<{ blob?: Blob; error?: string }>) => {
        if (event.data.blob) resolve(event.data.blob);
        else fail(event.data.error ?? "Could not decode this image.");
      });
      void readBinaryPreview(src, controller.signal).then(
        (bytes) => worker.postMessage({ bytes }, [bytes]),
        reject,
      );
    });
  } finally {
    controller.abort();
    worker.terminate();
  }
}
