// ADR-028. Unlike the screen tests (which mock this module at its own boundary because
// `expo-media-library`/`expo-sharing` crash outright under Jest), this file is the seam itself,
// so it mocks the two native packages directly -- the same split ADR-022's SQLite seam and
// ADR-026's notification seam already established.
jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn(),
  saveToLibraryAsync: jest.fn(),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { appOwnership: null },
  AppOwnership: { Expo: 'expo' },
}));

import Constants, { AppOwnership } from 'expo-constants';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import type { RefObject } from 'react';
import type { ViewShotRef } from 'react-native-view-shot';

import { SharePermissionDeniedError, isExpoGo, saveShareCardToPhotos, shareShareCard } from '../share-capture';

function refWithCapture(capture: jest.Mock | null): RefObject<ViewShotRef | null> {
  return { current: capture ? ({ capture } as unknown as ViewShotRef) : null };
}

beforeEach(() => {
  jest.clearAllMocks();
  (Constants as unknown as { appOwnership: string | null }).appOwnership = null;
});

describe('isExpoGo', () => {
  it('is true when the app is running inside the Expo Go client', () => {
    (Constants as unknown as { appOwnership: string | null }).appOwnership = AppOwnership.Expo;
    expect(isExpoGo()).toBe(true);
  });

  it('is false for a dev-client or standalone build', () => {
    (Constants as unknown as { appOwnership: string | null }).appOwnership = null;
    expect(isExpoGo()).toBe(false);
  });
});

describe('saveShareCardToPhotos', () => {
  it('captures the card and writes it to the library once permission is granted', async () => {
    const capture = jest.fn().mockResolvedValue('file:///tmp/card.jpg');
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });

    await saveShareCardToPhotos(refWithCapture(capture));

    expect(capture).toHaveBeenCalledTimes(1);
    expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///tmp/card.jpg');
  });

  it('throws SharePermissionDeniedError and never captures when permission is refused', async () => {
    const capture = jest.fn();
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });

    await expect(saveShareCardToPhotos(refWithCapture(capture))).rejects.toBeInstanceOf(
      SharePermissionDeniedError,
    );
    expect(capture).not.toHaveBeenCalled();
    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
  });

  it('refuses to capture a card that has not mounted yet', async () => {
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });

    await expect(saveShareCardToPhotos(refWithCapture(null))).rejects.toThrow(
      'Share card is not ready to capture yet.',
    );
  });
});

describe('shareShareCard', () => {
  it('captures the card and opens the OS share sheet with the given dialog title', async () => {
    const capture = jest.fn().mockResolvedValue('file:///tmp/card.jpg');
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);

    await shareShareCard(refWithCapture(capture), 'Share to Instagram');

    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///tmp/card.jpg', {
      dialogTitle: 'Share to Instagram',
      mimeType: 'image/jpeg',
    });
  });

  it('throws rather than opening a share sheet the OS says is unavailable', async () => {
    const capture = jest.fn().mockResolvedValue('file:///tmp/card.jpg');
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);

    await expect(shareShareCard(refWithCapture(capture), 'Share to More')).rejects.toThrow(
      'Sharing is not available on this device.',
    );
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
});
