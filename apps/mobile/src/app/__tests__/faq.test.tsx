// F1 -- Profile → FAQ. Tap a question to open its answer; the sources sit under the answer.
//
// NOTE: @testing-library/react-native v14 makes render() and every fireEvent.* async.
import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args), push: jest.fn() },
}));

jest.mock('@/features/flags/feature-flags', () => ({ useFeatureFlag: jest.fn(() => false) }));

import { useFeatureFlag } from '@/features/flags/feature-flags';
import FaqScreen from '../faq';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

beforeEach(() => jest.clearAllMocks());

describe('FaqScreen', () => {
  it('lists the sections and the questions, with every answer closed', async () => {
    await render(<FaqScreen />);
    expect(screen.getByText('FAQ')).toBeTruthy();
    expect(screen.getByText('Your rank and the leaderboard')).toBeTruthy();
    expect(screen.getByText('Runs')).toBeTruthy();
    expect(screen.getByText('How is my Activity score worked out?')).toBeTruthy();
    expect(screen.getByText('How does FORJD measure a run?')).toBeTruthy();
    expect(screen.queryByText(/Up to 70 points/)).toBeNull();
  });

  it('opens an answer with its source when the question is tapped, and closes it again', async () => {
    await render(<FaqScreen />);
    const question = screen.getByText('How is my Activity score worked out?');

    await fireEvent.press(question);
    expect(screen.getByText(/Up to 70 points/)).toBeTruthy();
    expect(screen.getByText(/Bull FC/)).toBeTruthy();

    await fireEvent.press(question);
    expect(screen.queryByText(/Up to 70 points/)).toBeNull();
  });

  it('tells a screen reader whether a question is open', async () => {
    await render(<FaqScreen />);
    const button = screen.getByRole('button', { name: 'How is "Top 8%" worked out?' });
    expect(button.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(button);
    expect(screen.getByRole('button', { name: 'How is "Top 8%" worked out?' }).props.accessibilityState).toMatchObject({
      expanded: true,
    });
  });

  it('goes back to Profile', async () => {
    await render(<FaqScreen />);
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(mockReplace).toHaveBeenCalledWith('/profile');
  });

  describe('Weekly Forge (weekly-forge-explainer-plan.md X5, approved wording in faq-copy.md)', () => {
    it('stays hidden while Weekly Forge is switched off', async () => {
      (useFeatureFlag as jest.Mock).mockReturnValue(false);
      await render(<FaqScreen />);

      expect(screen.queryByText('Weekly Forge')).toBeNull();
      expect(screen.queryByText('What is Weekly Forge?')).toBeNull();
    });

    it('lists its nine questions once Weekly Forge is on, after the Rank section', async () => {
      (useFeatureFlag as jest.Mock).mockReturnValue(true);
      await render(<FaqScreen />);

      expect(useFeatureFlag).toHaveBeenCalledWith('weekly_forge');
      for (const question of [
        'What is Weekly Forge?',
        'What counts toward each ladder?',
        'When does my week start and end?',
        'How do I go up a level?',
        'What happens if I miss a week?',
        'What are the bands, and where do the goals come from?',
        'How do I reach Forged?',
        'Can I share my level?',
        'Who can see my levels?',
      ]) {
        expect(screen.getByText(question)).toBeTruthy();
      }
      const titles = screen.getAllByText(/^(Your rank and the leaderboard|Weekly Forge|Your training numbers)$/);
      expect(titles.map((title) => title.props.children)).toEqual([
        'Your rank and the leaderboard',
        'Weekly Forge',
        'Your training numbers',
      ]);
    });

    it('opens an answer, with its list', async () => {
      (useFeatureFlag as jest.Mock).mockReturnValue(true);
      await render(<FaqScreen />);

      await fireEvent.press(screen.getByText('What counts toward each ladder?'));

      expect(screen.getByText('Volume: weight × reps across all sets, warm-ups included.')).toBeTruthy();
    });
  });
});
