/**
 * The `OverdeckLiveActivity` native plugin (PAN-4839): starts and ends the counts-only Live Activity
 * and reports its APNs activity push token. iOS 16.2 and later only; the web stand-in and Android
 * answer `supported: false`. The card shows two counts and nothing else (OD-1).
 */
import { registerPlugin, WebPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { ApsEnvironment } from '@overdeck/contracts';

export interface LiveActivityStatus {
  /** iOS 16.2 or later. */
  supported: boolean;
  /** The operator allows Live Activities for Overdeck in iOS Settings. */
  enabled: boolean;
}

export interface LiveActivityToken {
  /** Lowercase hex. */
  token: string;
  apsEnvironment: ApsEnvironment;
}

export interface OverdeckLiveActivityPlugin {
  status(): Promise<LiveActivityStatus>;
  /** Starts the card, or keeps the running one; `started` is false when unsupported or not allowed. */
  start(): Promise<{ started: boolean }>;
  /** Ends every Overdeck Live Activity at once. */
  end(): Promise<void>;
  addListener(event: 'token', listener: (token: LiveActivityToken) => void): Promise<PluginListenerHandle>;
}

/** Browser stand-in (development only): Live Activities are unsupported. */
class OverdeckLiveActivityWeb extends WebPlugin {
  async status(): Promise<LiveActivityStatus> {
    return { supported: false, enabled: false };
  }

  async start(): Promise<{ started: boolean }> {
    return { started: false };
  }

  async end(): Promise<void> {}
}

export const OverdeckLiveActivity = registerPlugin<OverdeckLiveActivityPlugin>('OverdeckLiveActivity', {
  web: () => new OverdeckLiveActivityWeb(),
});
