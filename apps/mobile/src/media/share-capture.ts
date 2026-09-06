import Constants, { AppOwnership } from 'expo-constants';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import type { RefObject } from 'react';
import type { ViewShotRef } from 'react-native-view-shot';

/**
 * ADR-028: the one module both share screens go through to capture, save, and share their
 * preview card, so the two paths cannot drift the way the ADR's own context warns against.
 *
 * `ref` is `ViewShotRef | null` because a React ref starts null before mount; every function here
 * throws a clear error rather than crashing on `.current` of `null` if called before the card has
 * rendered, which cannot happen from a button press but is cheap to make impossible to misuse.
 *
 * **Addendum, 2026-09-06: the app must still run in plain Expo Go.** ADR-028 assumed the switch
 * to a dev-client build would happen immediately; in practice the user deferred enrolling in the
 * Apple Developer Program (needed to sign any dev-client build for a physical iPhone) until
 * closer to production. `react-native-view-shot` calls
 * `TurboModuleRegistry.getEnforcing("RNViewShot")`, which **throws the instant the module is
 * imported** if the native module is not registered -- not only when `capture()` is called. Expo
 * Go does not register it, so a plain top-level `import` of the library would crash both share
 * screens outright the moment they render, under Expo Go specifically.
 *
 * `isExpoGo()` is the guard both screens check before ever `require`-ing `react-native-view-shot`
 * (see their own files for the lazy import) and before calling the functions below. In Expo Go,
 * the screens fall back to the same toast-only mock this feature replaced, so Expo Go remains a
 * fully valid way to test everything else in the app; a dev-client build is only required to
 * exercise the real capture/save/share path itself.
 */
export function isExpoGo(): boolean {
  return Constants.appOwnership === AppOwnership.Expo;
}

export class SharePermissionDeniedError extends Error {
  constructor() {
    super('Photo library permission was not granted.');
    this.name = 'SharePermissionDeniedError';
  }
}

async function capture(ref: RefObject<ViewShotRef | null>): Promise<string> {
  const capturer = ref.current?.capture;
  if (!capturer) {
    throw new Error('Share card is not ready to capture yet.');
  }
  return capturer();
}

/** Save Image. Captures the card, then writes it to the device's photo library. */
export async function saveShareCardToPhotos(ref: RefObject<ViewShotRef | null>): Promise<void> {
  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission.granted) {
    throw new SharePermissionDeniedError();
  }

  const uri = await capture(ref);
  await MediaLibrary.saveToLibraryAsync(uri);
}

/**
 * Instagram / More. Both open the OS share sheet -- there is no Instagram-specific deep link
 * (see ADR-028 for why). The share sheet itself lists Instagram as a target when it is installed.
 */
export async function shareShareCard(ref: RefObject<ViewShotRef | null>, dialogTitle: string): Promise<void> {
  const uri = await capture(ref);

  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Sharing is not available on this device.');
  }

  await Sharing.shareAsync(uri, { dialogTitle, mimeType: 'image/jpeg' });
}
