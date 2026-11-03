import { Capacitor } from '@capacitor/core';
import type { ClientPlatform } from '@overdeck/contracts';

/** The phone platform; a desktop browser (development only) reports as Android. */
export function shellPlatform(): ClientPlatform {
  return Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
}
