// The Weekly Forge share card, as approved in the Phase 7 mock-ups (item J): the badge, the band,
// the ladder and its weekly target, the level, the athlete's username and the FORJD logo. Nothing
// else about the athlete, and never Nourish.
import { render, screen } from '@testing-library/react-native';

import { ForgeShareCard } from '../forge-share-card';

describe('ForgeShareCard', () => {
  it('shows the band, the ladder and its weekly target, the level and the username', async () => {
    await render(<ForgeShareCard ladder="volume" band="ember" level={7} username="mostafa" />);

    expect(screen.getByText('Weekly Forge')).toBeTruthy();
    expect(screen.getByText('Ember')).toBeTruthy();
    expect(screen.getByText('Volume · 5,600 kg a week')).toBeTruthy();
    expect(screen.getByText('Level 7')).toBeTruthy();
    expect(screen.getByText('@mostafa')).toBeTruthy();
    expect(screen.getByLabelText('FORJD symbol')).toBeTruthy();
  });

  it('leaves the username out for an account that has none', async () => {
    await render(<ForgeShareCard ladder="distance" band="forged" level={28} username={null} />);

    expect(screen.getByText('Distance · 157.5 km a week')).toBeTruthy();
    expect(screen.queryByText(/^@/)).toBeNull();
  });

  it('refuses to draw Nourish, which is never shared', async () => {
    await render(<ForgeShareCard ladder="nourish" band="ember" level={3} username="mostafa" />);

    expect(screen.queryByText('Weekly Forge')).toBeNull();
  });
});
