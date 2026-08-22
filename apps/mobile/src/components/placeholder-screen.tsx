import { Text, View } from 'react-native';

import { ScreenBackground } from '@/components/screen-background';

interface PlaceholderScreenProps {
  name: string;
}

/**
 * Placeholder content only — real data for these screens lands in future slices (see
 * roadmap.md's slice table and the mobile-pivot plan's §9). This exists so the tab shell is
 * fully navigable now without pulling forward any of slices 2-8.
 */
export function PlaceholderScreen({ name }: PlaceholderScreenProps) {
  return (
    <ScreenBackground>
      <View className="flex-1 items-center justify-center">
        {/* Lowercased on purpose: the tab bar already renders the capitalized label ("Home",
            "Train", ...) — keeping this text distinct avoids ambiguous text queries in tests
            that look up the tab bar by label. */}
        {/* `text-screen-header` carries only the size/leading/tracking. The design's header
            is `700 26px/1.15`, so the weight has to be asked for separately. */}
        <Text className="font-archivo text-screen-header font-bold text-text">
          {`${name.toLowerCase()} — coming soon`}
        </Text>
      </View>
    </ScreenBackground>
  );
}
