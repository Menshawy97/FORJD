import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { colors } from '@/theme/tokens';

/**
 * Home's header. Unlike every other screen this one does not use `components/header.tsx` --
 * the prototype gives Home a bespoke header (a four-bar mark, the FORJD wordmark, a greeting
 * beneath it, and a bell on the right) rather than the shared title-and-back-chevron row.
 * `profile.tsx` is the precedent for a tab screen owning its own header.
 *
 * The bell renders but goes nowhere. Its design destination is `notifsFeed`, a screen that
 * does not exist yet -- `notifs.tsx` is the *settings* screen, a different one -- so this
 * follows `train.tsx`'s precedent of rendering the control without wiring it to a route that
 * isn't there. The prototype's unread dot is also left off deliberately: there is no unread
 * state to read it from, and a dot that is always lit is a lie about having notifications.
 */
interface HomeHeaderProps {
  /** Null when the account has no profile or no display name yet -- both are real states. */
  firstName: string | null;
}

export function HomeHeader({ firstName }: HomeHeaderProps) {
  return (
    <View className="flex-row items-start justify-between px-screen-x pb-2">
      <View className="flex-row items-center gap-[10px]">
        <Icon name="wordmark" size={22} color={colors.accent} />
        <View className="gap-1">
          <Text className="font-archivo text-wordmark-home font-extrabold text-text">FORJD</Text>
          {firstName === null ? null : (
            <Text className="font-archivo text-home-meta font-medium text-metadata">
              {`Hi, ${firstName}`}
            </Text>
          )}
        </View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Notifications" className="mt-[2px]">
        <Icon name="bell" size={22} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}
