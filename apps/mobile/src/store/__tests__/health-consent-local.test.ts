// ADR-043 / R8: a run decides at its start, with no network (CLAUDE.md rule 6), whether it may read a
// watch's heart rate. The real flag is on the server; this is the device's copy, written whenever a
// screen learns the truth and read by the run, exactly as the leaderboard consent is (ADR-048).
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  HEALTH_CONSENT_STORAGE_KEY,
  forgetHealthConsent,
  readHealthConsent,
  rememberHealthConsent,
} from '../health-consent-local';
import { hasAskedRunHealthAccess, markRunHealthAccessAsked } from '../run-health-access';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('health consent, device copy', () => {
  it('is unknown until a screen has told the device', async () => {
    expect(await readHealthConsent()).toBeNull();
  });

  it('remembers yes and no, and forgets them at sign-out', async () => {
    await rememberHealthConsent(true);
    expect(await readHealthConsent()).toBe(true);
    await rememberHealthConsent(false);
    expect(await readHealthConsent()).toBe(false);
    await forgetHealthConsent();
    expect(await readHealthConsent()).toBeNull();
  });

  it('treats an unreadable value as unknown, never as a yes', async () => {
    await AsyncStorage.setItem(HEALTH_CONSENT_STORAGE_KEY, '{"enabled":"yes"}');
    expect(await readHealthConsent()).toBeNull();
    await AsyncStorage.setItem(HEALTH_CONSENT_STORAGE_KEY, 'not json');
    expect(await readHealthConsent()).toBeNull();
  });

  it('never throws when storage fails', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    expect(await readHealthConsent()).toBeNull();
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk'));
    await expect(rememberHealthConsent(true)).resolves.toBeUndefined();
  });
});

describe('the run asks Health Connect once', () => {
  it('has not asked on a fresh device, and remembers once it has', async () => {
    expect(await hasAskedRunHealthAccess()).toBe(false);
    await markRunHealthAccessAsked();
    expect(await hasAskedRunHealthAccess()).toBe(true);
  });

  it('reads as not asked when storage fails, so a broken disk cannot silently skip a request', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    expect(await hasAskedRunHealthAccess()).toBe(false);
  });
});
