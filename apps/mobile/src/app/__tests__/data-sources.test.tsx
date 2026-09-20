// Phase 10L. The "Data sources" page under Profile. Its reason to exist is a licence obligation:
// GeoNames is CC BY 4.0, which requires visible attribution, a link to the licence, and a note
// that the data was changed. It must therefore say all three, and the links must actually open.
import { fireEvent, render as rtlRender } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  Link: 'Link',
}));

import DataSourcesScreen from '../data-sources';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

describe('DataSourcesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  });

  it('is titled Data sources and backs out to Profile', async () => {
    const { findByText, findByLabelText } = await render(<DataSourcesScreen />);

    expect(await findByText('Data sources')).toBeTruthy();
    await fireEvent.press(await findByLabelText('Back'));
    expect(mockReplace).toHaveBeenCalledWith('/profile');
  });

  it('credits GeoNames under its licence, and says the data was changed', async () => {
    const { findByText, getByText, getAllByText } = await render(<DataSourcesScreen />);

    expect(await findByText('GeoNames')).toBeTruthy();
    expect(getAllByText(/CC BY 4.0/, { exact: false }).length).toBeGreaterThan(0);
    // CC BY 4.0 section 3(a)(1)(B): indicate if modifications were made.
    expect(getByText(/has been changed/i, { exact: false })).toBeTruthy();
  });

  it('opens the GeoNames site and the licence when their links are pressed', async () => {
    const { findByRole } = await render(<DataSourcesScreen />);

    await fireEvent.press(await findByRole('link', { name: 'Open the GeoNames website' }));
    expect(Linking.openURL).toHaveBeenCalledWith('https://www.geonames.org/');

    await fireEvent.press(await findByRole('link', { name: 'Read the CC BY 4.0 licence' }));
    expect(Linking.openURL).toHaveBeenCalledWith('https://creativecommons.org/licenses/by/4.0/');
  });

  it("says where the activity score's targets come from, without calling it AI", async () => {
    const { findByText, getByText, queryByText } = await render(<DataSourcesScreen />);

    expect(await findByText('World Health Organization')).toBeTruthy();
    expect(getByText(/2020/, { exact: false })).toBeTruthy();
    expect(queryByText(/\bAI\b/, { exact: false })).toBeNull();
  });

  it('states that exact location is not stored', async () => {
    const { findByText } = await render(<DataSourcesScreen />);

    expect(await findByText(/never stored/i, { exact: false })).toBeTruthy();
  });
});
