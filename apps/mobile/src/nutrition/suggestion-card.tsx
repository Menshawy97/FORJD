import type { MacroGoalSuggestionResponse, SetMacroGoalsRequest } from '@forjd/contracts';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Icon } from '@/components/icon';
import { activityLevelLabel, withThousands } from '@/features/targets/labels';
import { colors } from '@/theme/tokens';

interface SuggestionCardProps {
  /** The suggestion; undefined while it loads, null when it could not be loaded. */
  response: MacroGoalSuggestionResponse | null | undefined;
  /** Saves these as the daily targets. Nothing changes until this is tapped. */
  onUse: (targets: SetMacroGoalsRequest) => void;
  onEditInProfile: () => void;
}

const DIM = { color: '#a9a9a0' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso: string): string => {
  const date = new Date(iso);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
};

/** The goal's row: its short name with the change, and the working from maintenance. */
function goalRow(basis: NonNullable<MacroGoalSuggestionResponse['basis']>): { label: string; formula: string } {
  const maintenance = withThousands(basis.maintenanceKcal);
  const percent = Math.round(Math.abs(basis.energyChange) * 100);
  switch (basis.bodyGoal) {
    case 'lose_fat':
      return { label: `Lose fat −${percent}%`, formula: `${maintenance} − ${percent}%` };
    case 'recomposition':
      return { label: `Recomp −${percent}%`, formula: `${maintenance} − ${percent}%` };
    case 'build_muscle':
      return { label: `Build muscle +${percent}%`, formula: `${maintenance} + ${percent}%` };
    default:
      return { label: 'Maintain', formula: 'at maintenance' };
  }
}

/** The plain circled "i", no box (the approved design): grey closed, accent open. */
function InfoGlyph({ color }: { color: string }) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9.25} stroke={color} strokeWidth={1.7} />
      <Path d="M12 11v5.5" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
      <Circle cx={12} cy={7.6} r={1.2} fill={color} />
    </Svg>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <View
      className="rounded-[11px] border px-[14px] py-3"
      style={{ gap: 8, borderColor: 'rgba(233,113,47,.4)', backgroundColor: 'rgba(233,113,47,.1)' }}>
      {children}
    </View>
  );
}

function EditInProfile({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} hitSlop={6}>
      <Text className="font-archivo text-[11.5px] font-semibold text-accent">Edit in Profile ›</Text>
    </Pressable>
  );
}

/**
 * The Auto-calculate card on Set daily goals (docs/product/scan-height-age-plan.md §4.5; compact
 * design approved 2026-09-25). Closed, it shows the suggestion, the (i) and Use; the (i) opens one
 * line per step inside the card. The numbers all come from the API, so the app never recomputes.
 */
export function SuggestionCard({ response, onUse, onEditInProfile }: SuggestionCardProps) {
  const [open, setOpen] = useState(false);

  if (!response || response.suggestion === null || response.basis === null) {
    const needsProfile = response?.missing.some((m) => m === 'activityLevel' || m === 'bodyGoal') ?? false;
    const message =
      response === undefined
        ? 'Working out a suggestion…'
        : response === null
        ? "Couldn't load a suggestion right now."
        : needsProfile
          ? 'Add your activity level and goal in Profile to get a suggestion.'
          : 'Add a weight or an InBody scan to get a suggestion.';
    return (
      <Shell>
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <Icon name="bolt" color={colors.accent} size={17} />
          <View className="flex-1" style={{ minWidth: 0, gap: 2 }}>
            <Text className="font-archivo text-[13px] font-bold text-accent">Auto-calculate</Text>
            <Text className="font-archivo text-[11px] text-weekScoreLabel">{message}</Text>
          </View>
        </View>
        {needsProfile ? <EditInProfile onPress={onEditInProfile} /> : null}
      </Shell>
    );
  }

  const { suggestion, basis } = response;
  const goal = goalRow(basis);
  const rows: ReadonlyArray<readonly [string, string, string]> = [
    [
      'Maintenance',
      `${withThousands(basis.bmrKcal)} BMR × ${basis.activityFactor} ${activityLevelLabel(basis.activityLevel)}`,
      `${withThousands(basis.maintenanceKcal)} kcal`,
    ],
    [goal.label, goal.formula, `${withThousands(suggestion.kcal)} kcal`],
    ['Protein', `${basis.proteinPerKg} g × ${basis.weightKg} kg`, `${suggestion.protein} g`],
    ['Fat', `${Math.round(basis.fatShare * 100)}% of calories`, `${suggestion.fat} g`],
    ['Carbs', 'the rest', `${suggestion.carbs} g`],
  ];
  const bmrLine =
    basis.bmrSource === 'scan' && basis.scanMeasuredAt
      ? `BMR from your InBody scan, ${shortDate(basis.scanMeasuredAt)}.`
      : 'BMR estimated from your height, weight and age.';
  const proteinSources = basis.bodyGoal === 'recomposition' ? 'Morton 2018, Barakat 2020' : 'Morton 2018';

  return (
    <Shell>
      <View className="flex-row items-center" style={{ gap: 10 }}>
        <Icon name="bolt" color={colors.accent} size={17} />
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Text className="font-archivo text-[13px] font-bold text-accent">
            Suggested: {withThousands(suggestion.kcal)} kcal
          </Text>
          <Text className="mt-0.5 font-archivo text-[11px] text-weekScoreLabel">
            {`Protein ${suggestion.protein} g · Carbs ${suggestion.carbs} g · Fat ${suggestion.fat} g`}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? 'Hide how this is calculated' : 'How this is calculated'}
          accessibilityState={{ expanded: open }}
          hitSlop={6}
          onPress={() => setOpen((value) => !value)}
          className="h-[32px] w-[28px] items-center justify-center">
          <InfoGlyph color={open ? colors.accent : '#d4d4cc'} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Use"
          onPress={() => onUse(suggestion)}
          className="h-[32px] items-center justify-center rounded-[9px] px-[14px]"
          style={{ backgroundColor: colors.accentDark }}>
          <Text className="font-archivo text-[12.5px] font-bold text-white">Use</Text>
        </Pressable>
      </View>
      <Text className="font-archivo text-[11px]" style={DIM}>
        {basis.bmrSource === 'scan'
          ? 'Based on your InBody scan, activity level and goal.'
          : 'Based on your estimated BMR, activity level and goal.'}
      </Text>
      {open ? (
        <View style={{ gap: 8 }}>
          <View className="rounded-[10px] px-[12px] py-[4px]" style={{ backgroundColor: 'rgba(0,0,0,.22)' }}>
            {rows.map(([label, formula, result], index) => (
              <View
                key={label}
                className="flex-row items-center py-[6px]"
                style={{ gap: 8, borderTopWidth: index === 0 ? 0 : 1, borderColor: 'rgba(255,255,255,.06)' }}>
                <Text className="font-archivo text-[12px] font-semibold text-text" style={{ width: 92 }}>
                  {label}
                </Text>
                <Text className="flex-1 font-archivo text-[11.5px]" style={{ ...DIM, fontVariant: ['tabular-nums'] }}>
                  {formula}
                </Text>
                <Text
                  className="font-archivo text-[12.5px] font-bold"
                  style={{ color: index < 2 ? colors.accent : colors.text, fontVariant: ['tabular-nums'] }}>
                  {result}
                </Text>
              </View>
            ))}
          </View>
          {basis.minimumKcalApplied ? (
            // Whole-app review 8.5, L6-1, wording approved by the user 2026-09-25: without it the goal
            // row's result would not match its own formula when the target was raised.
            <Text className="font-archivo text-[10.5px]" style={{ ...DIM, lineHeight: 10.5 * 1.45 }}>
              {`Raised to the ${withThousands(basis.minimumKcalApplied)} kcal daily minimum (Harvard Health).`}
            </Text>
          ) : null}
          <View className="flex-row items-center justify-between" style={{ gap: 10 }}>
            <Text className="flex-1 font-archivo text-[10.5px]" style={{ ...DIM, lineHeight: 10.5 * 1.45 }}>
              {`${bmrLine} Protein: ${proteinSources}.`}
            </Text>
            <EditInProfile onPress={onEditInProfile} />
          </View>
        </View>
      ) : null}
    </Shell>
  );
}
