import { Text, View } from 'react-native';

/**
 * "Avg step count" (`progress strength 2.png`). Real as of Phase 6's light-up-the-UI slice --
 * `stepsToday` is `health-metrics.ts`'s `sumForLocalDate('steps', ...)`, a running total for
 * today rather than a single reading, since Health Connect reports steps in many small windows
 * across a day. Reads an em dash exactly as before until a provider has actually synced a
 * value in (nothing does yet -- `HealthConnectProvider`, 6F, is device-unverified per
 * ADR-035).
 */
interface StepCountCardProps {
  stepsToday: number | null;
}

export function StepCountCard({ stepsToday }: StepCountCardProps) {
  return (
    <View>
      <Text style={{ fontFamily: 'Archivo', fontSize: 22, fontWeight: '700', color: '#F6F5F3' }}>
        {stepsToday === null ? '—' : Math.round(stepsToday).toLocaleString('en-US')}
      </Text>
      <Text
        style={{
          marginTop: 6,
          fontFamily: 'Archivo',
          fontSize: 11.5,
          fontWeight: '500',
          color: '#6E6E66',
        }}>
        {stepsToday === null ? 'Connect Health Connect or Apple Health to see your steps.' : 'Steps today'}
      </Text>
    </View>
  );
}
