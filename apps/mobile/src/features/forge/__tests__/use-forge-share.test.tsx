// Sharing a Weekly Forge card from anywhere (weekly-forge-explainer-plan.md X4): the ladder screen
// and the profile section hand a card to `useForgeShare`, which lays it out on screen under an
// opaque cover (react-native-view-shot cannot capture views parked off screen), captures it and
// opens the share sheet. Expo Go cannot capture at all, so there it only says so.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';

jest.mock('@/media/share-capture', () => ({ isExpoGo: jest.fn(() => false), shareShareCard: jest.fn() }));
jest.mock('@/media/share-card-shot', () => {
  const { View: MockView } = require('react-native');
  const react = require('react');
  return {
    ShareCardShot: react.forwardRef((props: { children: unknown }, ref: unknown) => (
      <MockView ref={ref}>{props.children}</MockView>
    )),
  };
});
jest.mock('@/auth/apiClient', () => ({ getMe: jest.fn() }));

import { getMe } from '@/auth/apiClient';
import { Toast } from '@/components/toast';
import { isExpoGo, shareShareCard } from '@/media/share-capture';
import { EXPO_GO_SHARE_LINE, SHARE_ERROR_LINE, useForgeShare } from '../use-forge-share';

function Harness() {
  const share = useForgeShare();
  return (
    <View>
      <Text testID="username">{share.username ?? 'none'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Share" onPress={() => share.start((username) => <Text>{`THE CARD by ${username ?? 'nobody'}`}</Text>)}>
        <Text>Share</Text>
      </Pressable>
      {share.sheet}
      <Toast message={share.toastMessage} />
    </View>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (isExpoGo as jest.Mock).mockReturnValue(false);
  (getMe as jest.Mock).mockResolvedValue({ profile: { username: 'mostafa' } });
});

describe('useForgeShare', () => {
  it('knows the username for the card footer', async () => {
    await render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('username').props.children).toBe('mostafa'));
  });

  it('lays the card out, captures it once it has a size, opens the share sheet, and then closes', async () => {
    (shareShareCard as jest.Mock).mockResolvedValue(undefined);
    await render(<Harness />);

    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByText(/THE CARD/, { includeHiddenElements: true })).toBeTruthy();
    expect(shareShareCard).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent(screen.getByTestId('forge-share-shot', { includeHiddenElements: true }), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 375 } },
      });
    });

    await waitFor(() => expect(shareShareCard).toHaveBeenCalledTimes(1));
    expect((shareShareCard as jest.Mock).mock.calls[0]![1]).toBe('Share your Weekly Forge');
    await waitFor(() => expect(screen.queryByText(/THE CARD/, { includeHiddenElements: true })).toBeNull());
  });

  it('says so, and closes, when the share sheet cannot open', async () => {
    (shareShareCard as jest.Mock).mockRejectedValue(new Error('no sheet'));
    await render(<Harness />);

    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    await act(async () => {
      fireEvent(screen.getByTestId('forge-share-shot', { includeHiddenElements: true }), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 375 } },
      });
    });

    await waitFor(() => expect(screen.getByText(SHARE_ERROR_LINE)).toBeTruthy());
    expect(screen.queryByText(/THE CARD/, { includeHiddenElements: true })).toBeNull();
  });

  it('draws the username on a card shared before the username had arrived', async () => {
    let answer: (me: unknown) => void = () => undefined;
    (getMe as jest.Mock).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await render(<Harness />);

    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByText('THE CARD by nobody', { includeHiddenElements: true })).toBeTruthy();

    await act(async () => answer({ profile: { username: 'mostafa' } }));

    expect(screen.getByText('THE CARD by mostafa', { includeHiddenElements: true })).toBeTruthy();
  });

  it('in Expo Go, says sharing needs the full app instead of capturing', async () => {
    (isExpoGo as jest.Mock).mockReturnValue(true);
    await render(<Harness />);

    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));

    expect(screen.getByText(EXPO_GO_SHARE_LINE)).toBeTruthy();
    expect(screen.queryByText(/THE CARD/, { includeHiddenElements: true })).toBeNull();
    expect(shareShareCard).not.toHaveBeenCalled();
  });
});
