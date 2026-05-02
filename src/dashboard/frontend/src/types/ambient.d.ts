/**
 * Ambient type declarations for packages installed in the devcontainer
 * but not available during local type-checking.
 *
 * These packages are listed in package.json and are installed via the
 * devcontainer postCreateCommand. TypeScript sees them at build time
 * (inside Docker); these stubs prevent TS2307 errors in non-Docker envs.
 */

// ─── Panopticon Desktop Bridge ────────────────────────────────────────────────
// Injected by apps/desktop/src/preload.ts via contextBridge.exposeInMainWorld.
// Only present when running inside the Electron desktop app.

interface PanopticonBridgeDesktopSettings {
  tray: { showBadge: boolean; tooltipDetail: 'minimal' | 'full' };
  notifications: {
    inputNeeded: boolean;
    stuckAgents: boolean;
    mergeFailures: boolean;
    workComplete: boolean;
    planningDone: boolean;
    mergeReady: boolean;
  };
  autoStart: { enabled: boolean; nagCount: number; nagDismissed: boolean };
}

interface PanopticonBridge {
  isDesktopApp(): boolean;
  getServerUrl(): string | null;
  getWsUrl(): string | null;
  pickFolder(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  openTerminalWindow(sessionName: string, title: string): void;
  setAlwaysOnTop(value: boolean): void;
  onMenuAction(listener: (action: string) => void): () => void;
  getDesktopSettings(): Promise<PanopticonBridgeDesktopSettings>;
  updateDesktopSetting(key: string, value: unknown): Promise<void>;
  notify(
    eventType: keyof PanopticonBridgeDesktopSettings['notifications'],
    title: string,
    body: string,
  ): Promise<void>;
  restartDashboard(): Promise<void>;
}

interface Window {
  panopticonBridge?: PanopticonBridge;
}

declare module 'framer-motion' {
  import * as React from 'react';

  export type Variants = Record<string, Record<string, unknown>>;
  export type Transition = Record<string, unknown>;
  export type HTMLMotionProps<T extends keyof React.JSX.IntrinsicElements> =
    React.ComponentProps<T> & {
      initial?: Record<string, unknown> | string;
      animate?: Record<string, unknown> | string;
      exit?: Record<string, unknown> | string;
      transition?: Transition;
      variants?: Variants;
      layout?: boolean | string;
      layoutId?: string;
      whileHover?: Record<string, unknown>;
      whileTap?: Record<string, unknown>;
    };

  type MotionComponent = {
    [K in keyof React.JSX.IntrinsicElements]: React.ComponentType<
      HTMLMotionProps<K>
    >;
  };

  export const motion: MotionComponent;
  export const AnimatePresence: React.FC<{
    children?: React.ReactNode;
    mode?: 'sync' | 'wait' | 'popLayout';
    initial?: boolean;
    onExitComplete?: () => void;
  }>;
}

declare module '@visx/group' {
  import * as React from 'react';
  export interface GroupProps {
    top?: number;
    left?: number;
    children?: React.ReactNode;
    [key: string]: unknown;
  }
  export const Group: React.FC<GroupProps>;
}

declare module '@visx/shape' {
  import * as React from 'react';
  export interface ArcProps {
    innerRadius?: number;
    outerRadius?: number;
    startAngle?: number;
    endAngle?: number;
    [key: string]: unknown;
  }
  export function Arc(props: ArcProps & { children?: (props: { path: unknown }) => React.ReactNode }): React.ReactElement;
  export function Pie(props: Record<string, unknown> & { children?: (props: unknown) => React.ReactNode }): React.ReactElement;
}

declare module '@visx/scale' {
  export function scaleOrdinal<Domain, Range>(config: {
    domain?: Domain[];
    range?: Range[];
  }): (value: Domain) => Range;
}
