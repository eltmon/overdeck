// PAN-5585: the iOS keyboard shrinks the visual viewport, not the layout
// viewport, and 100vh/100dvh do not follow it. These variables do.
import { useEffect } from 'react';

export const APP_HEIGHT_VAR = '--app-height';
export const APP_OFFSET_TOP_VAR = '--app-offset-top';

type ViewportLike = Pick<VisualViewport, 'height' | 'offsetTop' | 'scale'>;

export function applyVisualViewportVars(root: HTMLElement, vv: ViewportLike): void {
  if (Math.abs(vv.scale - 1) > 0.01) {
    root.style.removeProperty(APP_HEIGHT_VAR);
    root.style.removeProperty(APP_OFFSET_TOP_VAR);
    return;
  }
  // floor, never round up: a #root taller than a fractional viewport would scroll.
  root.style.setProperty(APP_HEIGHT_VAR, `${Math.floor(vv.height)}px`);
  root.style.setProperty(APP_OFFSET_TOP_VAR, `${Math.floor(vv.offsetTop)}px`);
}

export function useVisualViewportVars(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => applyVisualViewportVars(root, vv);
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
}
