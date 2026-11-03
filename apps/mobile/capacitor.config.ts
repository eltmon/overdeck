import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.overdeck.app',
  appName: 'Overdeck',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  plugins: { Browser: { presentationStyle: 'popover' } },
};

export default config;
