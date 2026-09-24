import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

import { SYMBOL_PATH } from './brand-paths';

interface LogoMarkProps {
  size: number;
  color?: string;
}

/** The FORJD symbol (ADR-052). */
export function LogoMark({ size, color = colors.accent }: LogoMarkProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="FORJD symbol" accessibilityRole="image">
      <Path fill={color} d={SYMBOL_PATH} />
    </Svg>
  );
}
