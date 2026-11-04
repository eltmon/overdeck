/** True inside the Overdeck phone app (Capacitor), whose `main.tsx` sets the flag before rendering (PAN-4823 W-APP1). */
export const isNativeShell = () => (globalThis as { __OVERDECK_NATIVE__?: boolean }).__OVERDECK_NATIVE__ === true;
