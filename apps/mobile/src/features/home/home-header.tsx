import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { LogoMark } from '@/components/brand/logo-mark';
import { Wordmark } from '@/components/brand/wordmark';
import { Icon } from '@/components/icon';
import { colors } from '@/theme/tokens';

/**
 * Home's header. Unlike every other screen this one does not use `components/header.tsx` --
 * the prototype gives Home a bespoke header (the ADR-052 symbol and drawn wordmark, a greeting
 * beneath it, and a bell on the right) rather than the shared title-and-back-chevron row.
 * `profile.tsx` is the precedent for a tab screen owning its own header.
 *
 * The bell opens the Notifications list (`app/notifications.tsx`, the prototype's `notifsFeed`;
 * walk finding 17) -- not `notifs.tsx`, which is the *settings* screen. The prototype's unread
 * dot is left off deliberately: there is no unread state to read it from, and a dot that is
 * always lit is a lie about having notifications.
 */
interface HomeHeaderProps {
  /** Null when the account has no profile or no display name yet -- both are real states. */
  firstName: string | null;
}

export function HomeHeader({ firstName }: HomeHeaderProps) {
  return (
    <View className="flex-row items-start justify-between px-screen-x pb-2">
      <View className="flex-row items-center gap-[10px]">
        <LogoMark size={26} />
        <View className="gap-[6px]">
          <Wordmark height={14} />
          {firstName === null ? null : (
            <Text className="font-archivo text-home-meta font-medium text-metadata">
              {`Hi, ${firstName}`}
            </Text>
          )}
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Notifications"
        onPress={() => router.push('/notifications')}
        hitSlop={10}
        className="mt-[2px]">
        <Icon name="bell" size={22} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}
