import { router } from 'expo-router';

import { hasSeenForgeHowItWorks, markForgeHowItWorksSeen } from '@/store/forge-how-it-works-shown';

// One check at a time: Home can refocus before the first read answers, and two checks would both
// see "not shown" and open two copies.
let isChecking = false;

/**
 * Opens Weekly Forge's How it works if this account has not been shown it yet
 * (docs/product/forge-how-it-works-once-plan.md). The note is written before the screen opens, so
 * coming back to Home does not open it again.
 */
export async function openForgeHowItWorksOnce(): Promise<void> {
  if (isChecking) {
    return;
  }
  isChecking = true;
  try {
    if (await hasSeenForgeHowItWorks()) {
      return;
    }
    await markForgeHowItWorksSeen();
    router.push('/forge/how-it-works');
  } finally {
    isChecking = false;
  }
}
