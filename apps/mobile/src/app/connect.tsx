import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { connectWhoop, disconnectWhoop, getWhoopStatus } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Icon, type IconName } from '@/components/icon';
import { pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { Spinner } from '@/components/spinner';
import { Toast, useToast } from '@/components/toast';
import { colors } from '@/theme/tokens';

/**
 * `s_connect()` (`FORJD Mobile.dc.html:1945-1969`), pixel-matched against
 * `screenshots/connected sources.png` -- built for Phase 7G. The design shows three sources
 * pre-connected/toggleable as a mock; only WHOOP is real here, per
 * `docs/product/phase-7-plan.md` slice 7G's decision. Apple Health (Phase 11) and Health
 * Connect (built in Phase 6F, but device-unverified -- ADR-035's own trigger, "before any UI
 * screen wires real users to this provider," has not been crossed) both render inert instead
 * of Connect/Disconnect, matching `profile.tsx`'s own "a Pressable to nowhere is worse than
 * no Pressable" precedent -- a deliberate, stated deviation from the design.
 *
 * Layout, verbatim from the prototype:
 *   back button: 44x44, margin '-5px 0 -5px -13px', radius 12 (NOT Header's 34x34/-8/radius
 *     10 -- s_connect() does not use `hdr()`, its title lives inside the scroll, not a fixed
 *     header row)
 *   h1 'Connect your data': mt 18px, `text-screen-header` (26px/1.15/-.02em) -- exact match
 *   subtitle: mt 10px mb 22px, 13.5px/1.45 (not the generic `body` token's 1.4 line-height)
 *   card list: gap 9px; each card 15/14px padding, radius 13px, gap 13px
 *   icon tile: 38x38, radius 10
 *   info card: `card()`'s own shape (surface/border/radius 14), 14/13px padding, mt 14px
 *   footer: border-top rgba(255,255,255,.06), 22/12/24px padding, Save button unchanged from
 *     every other settings screen (h-52, rounded-button, bg-accent, shadow-primary-button)
 */

interface SourceMeta {
  key: 'apple_health' | 'whoop' | 'health_connect';
  name: string;
  subtitle: string;
  icon: IconName;
}

const SOURCES: readonly SourceMeta[] = [
  { key: 'apple_health', name: 'Apple Health', subtitle: 'Steps, HR, sleep, workouts', icon: 'heart' },
  { key: 'whoop', name: 'WHOOP', subtitle: 'Recovery, strain, sleep', icon: 'bolt' },
  { key: 'health_connect', name: 'Health Connect', subtitle: 'Android health aggregation', icon: 'link' },
];

/** Since expo-web-browser's own redirect result is only a client-side signal (the browser
 *  can be dismissed in ways that never reach the app's redirect handler at all) -- the
 *  server's own status, re-fetched after the browser closes, is what actually decides the
 *  card's state, never the redirect URL's query string. */
const WHOOP_REDIRECT_URL = 'forjd://whoop-callback';

function describeFailure(error: unknown): string {
  return classifyRequestFailure(error) === 'offline' ? OFFLINE_MESSAGE : 'Could not reach FORJD. Please try again.';
}

export default function ConnectScreen() {
  const [whoopConnected, setWhoopConnected] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const refreshStatus = useCallback(async () => {
    try {
      const status = await getWhoopStatus();
      setWhoopConnected(status.connected);
    } catch (cause) {
      toast.show(describeFailure(cause));
    } finally {
      setLoaded(true);
    }
  }, [toast]);

  useFocusEffect(
    useCallback(() => {
      void refreshStatus();
    }, [refreshStatus]),
  );

  const goBack = () => router.replace('/profile');

  const handleConnectWhoop = async () => {
    setBusy(true);
    try {
      const { authorizeUrl } = await connectWhoop();
      await WebBrowser.openAuthSessionAsync(authorizeUrl, WHOOP_REDIRECT_URL);
      // Always re-confirm against the server rather than trusting the browser's own result --
      // the user may have completed consent, cancelled, or the browser may simply have been
      // dismissed with no way to distinguish those from the client side alone.
      await refreshStatus();
    } catch (cause) {
      toast.show(describeFailure(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnectWhoop = async () => {
    setBusy(true);
    try {
      await disconnectWhoop();
      setWhoopConnected(false);
    } catch (cause) {
      toast.show(describeFailure(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () => {
    toast.show('Connected sources updated');
    router.replace('/profile');
  };

  return (
    <ScreenBackground>
      <View className="flex-none px-screen-x pt-[14px]">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={goBack}
          className="h-[44px] w-[44px] items-center justify-center rounded-[12px]"
          style={({ pressed }) => [
            { marginTop: -5, marginBottom: -5, marginLeft: -13, marginRight: 0 },
            pressed && { backgroundColor: colors.pressedGhost },
          ]}>
          <Icon name="back" />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        <Text className="mt-[18px] font-archivo text-screen-header font-bold text-text">Connect your data</Text>
        <Text className="mb-[22px] mt-[10px] font-archivo text-body leading-[1.45] text-dim">
          FORJD reads. It never writes to your health data without asking.
        </Text>

        <View style={{ gap: 9 }}>
          {SOURCES.map((source) =>
            source.key === 'whoop' ? (
              <WhoopSourceCard
                key={source.key}
                meta={source}
                connected={whoopConnected}
                busy={busy}
                loaded={loaded}
                onConnect={handleConnectWhoop}
                onDisconnect={handleDisconnectWhoop}
              />
            ) : (
              <InertSourceCard key={source.key} meta={source} />
            ),
          )}
        </View>

        <View className="mt-[14px] rounded-card border border-border bg-surface px-[14px] py-[13px]">
          <View className="flex-row" style={{ gap: 11 }}>
            <View className="mt-[1px]">
              <Icon name="shield" size={18} color={colors.metadata} />
            </View>
            <Text className="flex-1 font-archivo text-[12px] leading-[1.5] text-dimmer">
              You choose what each source shares. Disconnect any time in Profile → Connected Sources.
            </Text>
          </View>
        </View>
      </ScrollView>

      <View
        className="flex-none border-t px-screen-x pb-6 pt-3"
        style={{ borderColor: 'rgba(255,255,255,.06)' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save"
          onPress={handleSave}
          style={pressScale}
          className="h-[52px] items-center justify-center rounded-button bg-accent shadow-primary-button">
          <Text className="font-archivo text-button font-bold text-white">Save</Text>
        </Pressable>
      </View>

      <Toast message={toast.message} />
    </ScreenBackground>
  );
}

interface WhoopSourceCardProps {
  meta: SourceMeta;
  connected: boolean;
  busy: boolean;
  loaded: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

function WhoopSourceCard({ meta, connected, busy, loaded, onConnect, onDisconnect }: WhoopSourceCardProps) {
  return (
    <SourceCardShell meta={meta} connected={connected}>
      {!loaded || busy ? (
        <Spinner />
      ) : connected ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Disconnect WHOOP"
          onPress={onDisconnect}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          className="px-[4px] py-[6px]"
          style={({ pressed }) => pressed && { opacity: 0.75 }}>
          <Text className="font-archivo text-[11.5px] font-semibold text-destructive">Disconnect</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Connect WHOOP"
          onPress={onConnect}
          className="rounded-chip bg-connectButtonBg px-[14px] py-[8px]"
          style={({ pressed }) => pressed && { backgroundColor: colors.connectButtonBgPressed }}>
          <Text className="font-archivo text-[12px] font-bold text-accent">Connect</Text>
        </Pressable>
      )}
    </SourceCardShell>
  );
}

/** Apple Health (Phase 11) and Health Connect (device-unverified, ADR-035) -- neither is
 *  actionable yet. No Pressable, no Connect/Disconnect pill: a plain, muted label is more
 *  honest than a control that does nothing, per `profile.tsx`'s own precedent. */
function InertSourceCard({ meta }: { meta: SourceMeta }) {
  return (
    <SourceCardShell meta={meta} connected={false}>
      <Text className="font-archivo text-[11px] text-dimmer">Coming soon</Text>
    </SourceCardShell>
  );
}

function SourceCardShell({
  meta,
  connected,
  children,
}: {
  meta: SourceMeta;
  connected: boolean;
  children: React.ReactNode;
}) {
  return (
    <View
      className="flex-row items-center rounded-[13px] border bg-surface px-[15px] py-[14px]"
      style={{ gap: 13, borderColor: connected ? colors.borderConnected : colors.border }}>
      <View
        className="h-[38px] w-[38px] items-center justify-center rounded-[10px]"
        style={{ backgroundColor: connected ? colors.connectIconBgOn : colors.connectIconBg }}>
        <Icon name={meta.icon} size={20} color={connected ? colors.green : colors.metadata} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-archivo text-[14.5px] font-semibold leading-none text-text">{meta.name}</Text>
        <Text className="mt-[5px] font-archivo text-[11.5px] leading-none text-dimmer">{meta.subtitle}</Text>
      </View>
      {children}
    </View>
  );
}
