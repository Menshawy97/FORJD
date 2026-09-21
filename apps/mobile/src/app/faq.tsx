import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Header } from '@/components/header';
import { Icon } from '@/components/icon';
import { pressGhost } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';
import { FAQ_SECTIONS, type FaqBlock, type FaqEntry } from '@/features/faq/faq-content';
import { colors } from '@/theme/tokens';

/**
 * Profile → FAQ (F1): how FORJD works out the numbers it shows, in plain words, with the published
 * sources where there are any. The words are `docs/product/faq-copy.md`, approved by the user.
 *
 * **There is no design for this screen** (the prototype has none), so it reuses the settings screens'
 * pieces: the `Header` with a back arrow, uppercase section labels, and `rounded-card` surfaces as on
 * Data sources, with tap-to-open rows. Nothing is invented beyond that. Several answers may be open
 * at once.
 */
function Answer({ blocks }: { blocks: readonly FaqBlock[] }) {
  return (
    <View style={{ gap: 8 }}>
      {blocks.map((block, index) =>
        'p' in block ? (
          <Text key={index} className="font-archivo text-[12.5px] leading-[1.5]" style={{ color: colors.dim }}>
            {block.p}
          </Text>
        ) : (
          <View key={index} style={{ gap: 6 }}>
            {block.list.map((item) => (
              <View key={item} className="flex-row" style={{ gap: 8 }}>
                <Text className="font-archivo text-[12.5px]" style={{ color: colors.dim }}>
                  •
                </Text>
                <Text className="flex-1 font-archivo text-[12.5px] leading-[1.5]" style={{ color: colors.dim }}>
                  {item}
                </Text>
              </View>
            ))}
          </View>
        ),
      )}
    </View>
  );
}

function FaqRow({ entry, open, onToggle }: { entry: FaqEntry; open: boolean; onToggle: () => void }) {
  return (
    <View className="mt-[8px] rounded-card border border-border bg-surface">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={entry.question}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={pressGhost}
        className="flex-row items-center rounded-card px-4 py-[14px]">
        <Text className="flex-1 font-archivo text-[13.5px] font-semibold leading-[1.35] text-text">{entry.question}</Text>
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }], marginLeft: 10 }}>
          <Icon name="chevron" size={16} color={colors.metadata} />
        </View>
      </Pressable>
      {open ? (
        <View className="px-4 pb-[15px]">
          <Answer blocks={entry.answer} />
          {entry.source ? (
            <Text className="mt-[10px] font-archivo text-[11px] leading-[1.5]" style={{ color: colors.dimmer }}>
              {`Source: ${entry.source}`}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function FaqScreen() {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());

  const toggle = (id: string) =>
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ScreenBackground>
      <Header title="FAQ" onBack={() => router.replace('/profile')} />

      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        <Text className="font-archivo text-[13px] leading-[1.5] text-dim">
          How FORJD works out the numbers you see, and where the method comes from. It compares training; it is not medical advice.
        </Text>

        {FAQ_SECTIONS.map((section) => (
          <View key={section.title}>
            <Text className="mb-[2px] mt-6 font-archivo text-section-label font-semibold uppercase text-label">
              {section.title}
            </Text>
            {section.entries.map((entry) => (
              <FaqRow key={entry.id} entry={entry} open={openIds.has(entry.id)} onToggle={() => toggle(entry.id)} />
            ))}
          </View>
        ))}
      </ScrollView>

      <TabBar active="profile" />
    </ScreenBackground>
  );
}
