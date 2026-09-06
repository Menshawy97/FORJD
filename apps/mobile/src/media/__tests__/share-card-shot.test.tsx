// This is the regression test for the crash `share-capture.ts`'s addendum describes:
// `react-native-view-shot` throws the instant it is required if its native module is not
// registered, which is Expo Go's case. `ShareCardShot` reads `isExpoGo()` once at module load to
// decide whether to `require` it at all, so each case below uses `jest.isolateModulesAsync` to
// get a fresh module instance with a fresh mock of `@/media/share-capture` in place first.
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

describe('ShareCardShot', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('@/media/share-capture');
    jest.dontMock('react-native-view-shot');
  });

  it('never requires react-native-view-shot in Expo Go, and renders a plain View instead', async () => {
    jest.doMock('@/media/share-capture', () => ({ isExpoGo: () => true }));
    // `react-native-view-shot` is deliberately left un-mocked: if the guard failed and this file
    // required it for real, the test would crash exactly as the addendum describes, rather than
    // merely failing an assertion -- the strongest proof the guard actually works.

    let ShareCardShot!: typeof import('../share-card-shot').ShareCardShot;
    await jest.isolateModulesAsync(async () => {
      ({ ShareCardShot } = require('../share-card-shot'));
    });

    // The strongest assertion here is simply that this renders at all: if the Expo Go guard
    // failed and the module required the real `react-native-view-shot`, this would crash rather
    // than fail an expectation.
    const { getByText } = await render(
      <ShareCardShot>
        <Text>card content</Text>
      </ShareCardShot>,
    );

    expect(getByText('card content')).toBeTruthy();
  });

  it('renders the real ViewShot outside Expo Go', async () => {
    jest.doMock('@/media/share-capture', () => ({ isExpoGo: () => false }));
    const FakeViewShot = jest.fn(({ children }: { children?: React.ReactNode }) => children);
    jest.doMock('react-native-view-shot', () => ({ __esModule: true, default: FakeViewShot }));

    let ShareCardShot!: typeof import('../share-card-shot').ShareCardShot;
    await jest.isolateModulesAsync(async () => {
      ({ ShareCardShot } = require('../share-card-shot'));
    });

    const { getByText } = await render(
      <ShareCardShot>
        <Text>card content</Text>
      </ShareCardShot>,
    );

    expect(getByText('card content')).toBeTruthy();
    expect(FakeViewShot).toHaveBeenCalled();
  });
});
