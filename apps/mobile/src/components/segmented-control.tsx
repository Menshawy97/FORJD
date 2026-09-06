import { Platform, Pressable, Text, View } from 'react-native';

import { colors } from '@/theme/tokens';

/**
 * The prototype's shared `segStyle()` / `miniSegStyle()` pattern -- a pill-track segmented
 * control used by the Progress tab's Strength/Body/Health control, the step-count card's
 * Day/Week/Month range, and Rank's `rankSegs` (`FORJD Mobile.dc.html:3298`, `:3300`).
 *
 * Two sizes, both transcribed exactly:
 *
 * - **`default`** (`segStyle`): track `padding:4` `borderRadius:12` `background:#141416`;
 *   segment `height:38` `borderRadius:9` `font:'600 13px/1 Archivo'`; active
 *   `background:#232326` `color:#F6F5F3` with a `0 1px 3px rgba(0,0,0,.4)` shadow; inactive
 *   `background:transparent` `color:#7E7E77`, no shadow.
 * - **`mini`** (`miniSegStyle`): track `padding:3` `borderRadius:10`; segment `height:30`
 *   `borderRadius:8` `font:'600 11.5px/1 Archivo'`; **no shadow in either state** -- the
 *   prototype's `miniSegStyle` never sets `boxShadow` at all, which is the one property that
 *   does not simply scale down between the two sizes.
 *
 * The active shadow is a real render-tree difference on Android, not just an iOS nicety:
 * `shadowColor`/`shadowOpacity`/`shadowOffset`/`shadowRadius` are iOS-only, so the active pill
 * needs `elevation` too or it reads flat on Android -- the reason this is one shared component
 * rather than three copies quietly drifting apart on that exact point.
 */
export interface SegmentedControlOption<T extends string> {
  label: string;
  value: T;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'default' | 'mini';
  /** Read by a screen-reader as the whole control's purpose, e.g. "Progress view". */
  accessibilityLabel?: string;
}

const SIZE = {
  default: { height: 38, borderRadius: 9, fontSize: 13, trackPadding: 4, trackRadius: 12 },
  mini: { height: 30, borderRadius: 8, fontSize: 11.5, trackPadding: 3, trackRadius: 10 },
} as const;

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'default',
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  const metrics = SIZE[size];

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={{
        flexDirection: 'row',
        gap: 4,
        padding: metrics.trackPadding,
        backgroundColor: colors.trackBg,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: metrics.trackRadius,
      }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[
              {
                flex: 1,
                height: metrics.height,
                borderRadius: metrics.borderRadius,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? colors.elevated3 : 'transparent',
              },
              // Only the default size carries a shadow -- miniSegStyle never sets one.
              active && size === 'default'
                ? Platform.select({
                    ios: {
                      shadowColor: '#000',
                      shadowOpacity: 0.4,
                      shadowOffset: { width: 0, height: 1 },
                      shadowRadius: 3,
                    },
                    android: { elevation: 2 },
                    default: {},
                  })
                : null,
            ]}>
            <Text
              style={{
                fontFamily: 'Archivo',
                fontWeight: '600',
                fontSize: metrics.fontSize,
                color: active ? colors.text : colors.segmentedInactive,
              }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
