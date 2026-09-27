import * as Haptics from 'expo-haptics';

/**
 * The app's only door to `expo-haptics`, approved with Weekly Forge's Phase 7 mock-ups: one
 * function per moment, so a caller names the moment rather than a vibration strength, and tests
 * mock this file instead of the native module.
 *
 * Haptics are not motion, so they still play when the phone asks for reduced motion. A phone
 * without a vibration motor (or with haptics switched off) rejects; that is never an error here.
 */
export async function hapticLevelUp(): Promise<void> {
  await quietly(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

export async function hapticNewBand(): Promise<void> {
  await quietly(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** A heavy strike as the Forged mark lands, then a success buzz. */
export async function hapticForged(): Promise<void> {
  await quietly(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
  await quietly(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

async function quietly(play: () => Promise<void>): Promise<void> {
  try {
    await play();
  } catch {
    // No motor, or haptics off in system settings: the celebration still plays without it.
  }
}
