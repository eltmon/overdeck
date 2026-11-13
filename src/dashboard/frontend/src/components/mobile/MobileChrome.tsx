/**
 * The `/m` web shell's setup chrome (PAN-5208 WI-7, WI-8): the install prompt, the settings sheet
 * behind the header's gear, and (later) the dismissible hints banner. None of it renders in the
 * phone app, where the native Settings screen owns these controls.
 *
 * `beforeinstallprompt` fires once, near page load, so `useInstallPrompt` lives in `MobileApp`
 * (mounted from the first render) and every view that offers installation receives its result.
 * A component mounted later, such as the sheet, would never see the event itself.
 */
import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';

import { useAppearance, writeAppearance } from '../../lib/appearance';
import { TurnOnNotificationsButton } from '../push/TurnOnNotificationsButton';
import { AppearanceChoice } from './AppearanceChoice';

/** The Chromium install event; not in the DOM lib types. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
}

export function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // Other iOS browsers (CriOS, FxiOS, EdgiOS) cannot add a web app to the home screen.
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export interface InstallPrompt {
  installEvent: BeforeInstallPromptEvent | null;
  install(): void;
  standalone: boolean;
  iosSafari: boolean;
}

/** Holds the install event from page load on. Call once, from `MobileApp`. */
export function useInstallPrompt(): InstallPrompt {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone] = useState(isStandalone);
  const [iosSafari] = useState(isIosSafari);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const install = useCallback(() => {
    if (!installEvent) return;
    setInstallEvent(null);
    void installEvent.prompt();
  }, [installEvent]);

  return { installEvent, install, standalone, iosSafari };
}

/** The `Install app` button, the iOS Safari hint, or nothing when installed or not installable. */
export function InstallAffordance({ prompt }: { prompt: InstallPrompt }) {
  if (prompt.standalone) return null;
  if (prompt.installEvent) {
    return (
      <button
        type="button"
        onClick={prompt.install}
        className="min-h-11 min-w-11 rounded-sm border border-border px-3 text-sm font-medium text-foreground"
      >
        Install app
      </button>
    );
  }
  if (prompt.iosSafari) {
    return <p className="text-xs text-muted-foreground">To install, tap Share, then Add to Home Screen</p>;
  }
  return null;
}

function InstallSection({ prompt }: { prompt: InstallPrompt }) {
  if (prompt.standalone) return <p className="text-xs text-muted-foreground">Installed</p>;
  if (prompt.installEvent || prompt.iosSafari) return <InstallAffordance prompt={prompt} />;
  return <p className="text-xs text-muted-foreground">Use your browser menu to add Overdeck to your Home Screen.</p>;
}

/** The `/m` settings sheet: appearance, install and notifications (PAN-5208 FR-2, FR-5). */
export function MobileSettingsSheet({ open, onClose, prompt }: { open: boolean; onClose(): void; prompt: InstallPrompt }) {
  const appearance = useAppearance();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div data-component="mobile-settings-scrim" className="fixed inset-0 z-50 bg-background/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-component="mobile-settings-sheet"
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col gap-5 overflow-y-auto rounded-t-md border-t border-border bg-card px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2"
      >
        <div className="flex min-h-11 items-center justify-between">
          <h2 className="text-base font-medium text-foreground">Settings</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-2 flex min-h-11 min-w-11 items-center justify-center text-muted-foreground"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <AppearanceChoice
          value={appearance}
          onChange={writeAppearance}
          note="System follows this device's light or dark setting. Stored in this browser only."
        />
        <div className="flex flex-col items-start gap-2">
          <h3 className="text-sm font-medium text-foreground">Install</h3>
          <InstallSection prompt={prompt} />
        </div>
        <div className="flex flex-col items-start gap-2">
          <h3 className="text-sm font-medium text-foreground">Notifications</h3>
          <TurnOnNotificationsButton />
        </div>
      </div>
    </>
  );
}
