import { Capacitor } from '@capacitor/core';
import type { PhonePlatform } from '@overdeck/contracts';

/** The phone platform; a desktop browser (development only) reports as Android. */
export function shellPlatform(): PhonePlatform {
  return Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
}
