import { useEffect } from 'react';
import { create } from 'zustand';
import { X } from 'lucide-react';

/**
 * PAN-4493: a single shared full-size viewer for a pasted/sent image. Opened
 * from the composer thumbnail or a sent-message attachment via
 * `openImageLightbox(src, alt)`; one host is mounted at the app root so the
 * lightbox outlives whatever opened it.
 */

interface ImageLightboxStore {
  image: { src: string; alt: string } | null;
  open: (src: string, alt: string) => void;
  close: () => void;
}

export const useImageLightboxStore = create<ImageLightboxStore>((set) => ({
  image: null,
  open: (src, alt) => set({ image: { src, alt } }),
  close: () => set({ image: null }),
}));

export function openImageLightbox(src: string, alt: string): void {
  useImageLightboxStore.getState().open(src, alt);
}

export function ImageLightboxHost() {
  const image = useImageLightboxStore((s) => s.image);
  const close = useImageLightboxStore((s) => s.close);

  useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [image, close]);

  if (!image) return null;

  return (
    <div
      data-testid="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-6"
      onClick={close}
    >
      <button type="button" aria-label="Close" onClick={close} className="absolute right-4 top-4 text-white/80 hover:text-white">
        <X size={24} />
      </button>
      <img
        src={image.src}
        alt={image.alt}
        className="max-h-full max-w-full object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
