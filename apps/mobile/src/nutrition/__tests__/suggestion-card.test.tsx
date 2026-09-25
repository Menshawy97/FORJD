// The live Auto-calculate card on Set daily goals (docs/product/scan-height-age-plan.md §4.5; the
// compact design with the (i) details was approved on 2026-09-25).
import type { MacroGoalSuggestionResponse } from '@forjd/contracts';
import { fireEvent, render } from '@testing-library/react-native';

import { SuggestionCard } from '../suggestion-card';

const basis: NonNullable<MacroGoalSuggestionResponse['basis']> = {
  maintenanceKcal: 3240,
  bmrKcal: 1905,
  bmrSource: 'scan',
  scanMeasuredAt: '2026-09-22T09:00:00.000Z',
  weightKg: 86.6,
  activityLevel: 'active',
  activityFactor: 1.7,
  bodyGoal: 'lose_fat',
  energyChange: -0.15,
  proteinPerKg: 1.6,
  fatShare: 0.25,
};
const loseFat: MacroGoalSuggestionResponse = {
  suggestion: { kcal: 2750, protein: 139, carbs: 377, fat: 76 },
  basis,
  missing: [],
};

async function renderCard(response: MacroGoalSuggestionResponse | null | undefined) {
  const handlers = { onUse: jest.fn(), onEditInProfile: jest.fn() };
  const utils = await render(<SuggestionCard response={response} {...handlers} />);
  return { ...utils, ...handlers };
}

describe('SuggestionCard', () => {
  it('shows the suggestion and what it is based on, with the details closed', async () => {
    const { getByText, queryByText } = await renderCard(loseFat);

    expect(getByText('Suggested: 2,750 kcal')).toBeTruthy();
    expect(getByText('Protein 139 g · Carbs 377 g · Fat 76 g')).toBeTruthy();
    expect(getByText('Based on your InBody scan, activity level and goal.')).toBeTruthy();
    expect(queryByText('Maintenance')).toBeNull();
  });

  it('opens every step of the calculation from the (i) button, and closes it again', async () => {
    const { getByRole, getByText, queryByText } = await renderCard(loseFat);

    await fireEvent.press(getByRole('button', { name: 'How this is calculated' }));

    expect(getByText('1,905 BMR × 1.7 Active')).toBeTruthy();
    expect(getByText('3,240 kcal')).toBeTruthy();
    expect(getByText('Lose fat −15%')).toBeTruthy();
    expect(getByText('3,240 − 15%')).toBeTruthy();
    expect(getByText('1.6 g × 86.6 kg')).toBeTruthy();
    expect(getByText('25% of calories')).toBeTruthy();
    expect(getByText('the rest')).toBeTruthy();
    expect(getByText('BMR from your InBody scan, 22 Sep. Protein: Morton 2018.')).toBeTruthy();

    await fireEvent.press(getByRole('button', { name: 'Hide how this is calculated' }));
    expect(queryByText('3,240 − 15%')).toBeNull();
  });

  it('names the recomposition sources and an estimated BMR', async () => {
    const recomp: MacroGoalSuggestionResponse = {
      suggestion: { kcal: 3080, protein: 191, carbs: 387, fat: 86 },
      basis: { ...basis, bodyGoal: 'recomposition', energyChange: -0.05, proteinPerKg: 2.2, bmrSource: 'estimate', scanMeasuredAt: null },
      missing: [],
    };
    const { getByRole, getByText } = await renderCard(recomp);

    expect(getByText('Based on your estimated BMR, activity level and goal.')).toBeTruthy();
    await fireEvent.press(getByRole('button', { name: 'How this is calculated' }));
    expect(getByText('Recomp −5%')).toBeTruthy();
    expect(getByText('BMR estimated from your height, weight and age. Protein: Morton 2018, Barakat 2020.')).toBeTruthy();
  });

  it('says so in the details when the suggestion was raised to the daily minimum (review 8.5, L6-1)', async () => {
    const floored: MacroGoalSuggestionResponse = {
      suggestion: { kcal: 1200, protein: 72, carbs: 153, fat: 33 },
      basis: { ...basis, maintenanceKcal: 1300, bmrKcal: 927, weightKg: 45, minimumKcalApplied: 1200 },
      missing: [],
    };
    const { getByRole, getByText } = await renderCard(floored);

    await fireEvent.press(getByRole('button', { name: 'How this is calculated' }));

    expect(getByText('Raised to the 1,200 kcal daily minimum (Harvard Health).')).toBeTruthy();
  });

  it('shows no minimum note when the goal already cleared it', async () => {
    const { getByRole, queryByText } = await renderCard({ ...loseFat, basis: { ...basis, minimumKcalApplied: null } });

    await fireEvent.press(getByRole('button', { name: 'How this is calculated' }));

    expect(queryByText(/daily minimum/)).toBeNull();
  });

  it('uses the suggestion, and opens Profile from the details', async () => {
    const { getByRole, getByText, onUse, onEditInProfile } = await renderCard(loseFat);

    await fireEvent.press(getByRole('button', { name: 'Use' }));
    expect(onUse).toHaveBeenCalledWith({ kcal: 2750, protein: 139, carbs: 377, fat: 76 });

    await fireEvent.press(getByRole('button', { name: 'How this is calculated' }));
    await fireEvent.press(getByText('Edit in Profile ›'));
    expect(onEditInProfile).toHaveBeenCalled();
  });

  it('asks for an activity level and goal when the profile has none', async () => {
    const { getByText, queryByRole } = await renderCard({ suggestion: null, basis: null, missing: ['activityLevel', 'bodyGoal'] });

    expect(getByText('Add your activity level and goal in Profile to get a suggestion.')).toBeTruthy();
    expect(getByText('Edit in Profile ›')).toBeTruthy();
    expect(queryByRole('button', { name: 'Use' })).toBeNull();
  });

  it('asks for a weight when there is nothing to work from', async () => {
    const { getByText } = await renderCard({ suggestion: null, basis: null, missing: ['weight', 'bmr'] });

    expect(getByText('Add a weight or an InBody scan to get a suggestion.')).toBeTruthy();
  });

  it('says it is working while the suggestion loads', async () => {
    const { getByText } = await renderCard(undefined);

    expect(getByText('Working out a suggestion…')).toBeTruthy();
  });

  it('says so when the suggestion could not be loaded', async () => {
    const { getByText } = await renderCard(null);

    expect(getByText("Couldn't load a suggestion right now.")).toBeTruthy();
  });
});
