import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import type { ViewShotRef } from 'react-native-view-shot';

import { getMe } from '@/auth/apiClient';
import { useToast } from '@/components/toast';
import type * as ShareCaptureModule from '@/media/share-capture';
import type * as ShareCardShotModule from '@/media/share-card-shot';

/**
 * Required when used, not imported at the top, for the reason `forge-celebration-screen.tsx`
 * gives: the screens that import this hook (the profile tab among them) must not load the share
 * modules -- `expo-media-library`, `react-native-view-shot` -- just by importing it.
 */
function shareModules(): { capture: typeof ShareCaptureModule; shot: typeof ShareCardShotModule } {
  return {
    capture: require('@/media/share-capture') as typeof ShareCaptureModule,
    shot: require('@/media/share-card-shot') as typeof ShareCardShotModule,
  };
}

export const SHARE_ERROR_LINE = 'Could not open the share sheet. Please try again.';
export const EXPO_GO_SHARE_LINE = 'Sharing works in the full app, not in Expo Go.';

export interface ForgeShare {
  /** Shares this card: lays it out, captures it at 1080 x 1350 and opens the phone's share sheet. */
  start: (card: ReactElement) => void;
  /** Render this in the screen; it is the capture's hidden full-screen layer while a share runs. */
  sheet: ReactElement | null;
  /** Feed to the screen's `<Toast>`: failures, and the Expo Go note. */
  toastMessage: string | null;
  /** The athlete's username for the card footer, once `getMe` answers. */
  username: string | null;
}

/**
 * Sharing a Weekly Forge card from the ladder screen and the profile section
 * (weekly-forge-explainer-plan.md X4, mock-ups D and F).
 *
 * `react-native-view-shot` is not reliable for views parked outside the window (see
 * `forge-celebration-screen.tsx`), and neither screen has an opaque layer the card could hide under.
 * So a share opens a plain full-screen layer for a moment: the card is laid out at the top-left,
 * covered by an opaque view, captured once it has a size, and the share sheet opens over it. The
 * layer closes when the sheet does. A second tap while one runs is ignored.
 *
 * Expo Go cannot load `react-native-view-shot` at all (ADR-028), so there it only says so, truthfully,
 * rather than pretending to share.
 */
export function useForgeShare(): ForgeShare {
  const toast = useToast();
  const [card, setCard] = useState<ReactElement | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => {
        if (!cancelled) {
          setUsername(me.profile?.username ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const start = useCallback(
    (next: ReactElement) => {
      if (shareModules().capture.isExpoGo()) {
        toast.show(EXPO_GO_SHARE_LINE);
        return;
      }
      setCard((current) => current ?? next);
    },
    [toast],
  );

  const finish = useCallback(
    (failed: boolean) => {
      setCard(null);
      if (failed) {
        toast.show(SHARE_ERROR_LINE);
      }
    },
    [toast],
  );

  return {
    start,
    sheet: card ? <ForgeShareLayer card={card} onDone={finish} /> : null,
    toastMessage: toast.message,
    username,
  };
}

function ForgeShareLayer({ card, onDone }: { card: ReactElement; onDone: (failed: boolean) => void }) {
  const { capture: captureModule, shot } = shareModules();
  const { ShareCardShot } = shot;
  const shotRef = useRef<ViewShotRef | null>(null);
  const hasStarted = useRef(false);

  const capture = () => {
    if (hasStarted.current) {
      return;
    }
    hasStarted.current = true;
    captureModule.shareShareCard(shotRef, 'Share your Weekly Forge').then(
      () => onDone(false),
      () => onDone(true),
    );
  };

  return (
    <Modal visible transparent={false} animationType="none" statusBarTranslucent onRequestClose={() => onDone(false)}>
      <View className="flex-1 bg-screenBg">
        <View
          testID="forge-share-shot"
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          collapsable={false}
          style={styles.shot}
          onLayout={capture}>
          <ShareCardShot ref={shotRef} options={{ format: 'jpg', quality: 0.92, width: 1080, height: 1350 }}>
            {card}
          </ShareCardShot>
        </View>
        <View style={StyleSheet.absoluteFill} className="bg-screenBg" />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shot: { position: 'absolute', left: 0, top: 0 },
});
