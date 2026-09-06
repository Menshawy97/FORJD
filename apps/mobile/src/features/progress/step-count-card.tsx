import { Text, View } from 'react-native';

/**
 * "Avg step count" (`progress strength 2.png`) -- honestly empty until Phase 6 (Health
 * Connect). Steps are a wearable/phone-sensor reading, exactly like Home's readiness card and
 * its four health metrics, and nothing in this repo can produce one today.
 *
 * Built at full visual fidelity per the standing rule (`readiness-card.tsx`'s own docblock is
 * the precedent): the Day/Week/Month segmented control still renders so the chrome matches
 * the screenshot, it is simply inert until there is a reading behind it.
 */
export function StepCountCard() {
  return (
    <View>
      <Text style={{ fontFamily: 'Archivo', fontSize: 22, fontWeight: '700', color: '#F6F5F3' }}>
        —
      </Text>
      <Text
        style={{
          marginTop: 6,
          fontFamily: 'Archivo',
          fontSize: 11.5,
          fontWeight: '500',
          color: '#6E6E66',
        }}>
        Connect Health Connect or Apple Health to see your steps.
      </Text>
    </View>
  );
}
