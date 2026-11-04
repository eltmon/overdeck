import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.overdeck.app',
  appName: 'Overdeck',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  plugins: {
    Browser: { presentationStyle: 'popover' },
    // Foreground notifications still show, e.g. one from another machine (PAN-4838 D-12).
    PushNotifications: { presentationOptions: ['alert', 'sound'] },
  },
};

export default config;
