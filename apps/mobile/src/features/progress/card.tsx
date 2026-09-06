import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

/**
 * The card shell every Progress-Strength section shares: `background:#17181A`,
 * `border:1px solid rgba(255,255,255,.07)`, `borderRadius:14`, `padding:15px 16px`,
 * `marginTop:12` -- transcribed from the prototype's repeated inline style, not a component
 * there, but pulled into one here so the seven cards on this screen cannot drift apart on it.
 */
interface CardProps {
  /** Omit for a card with no section heading (the FORJD Insight card draws its own). */
  title?: string;
  children: ReactNode;
}

export function Card({ title, children }: CardProps) {
  return (
    <View
      style={{
        backgroundColor: '#17181A',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,.07)',
        borderRadius: 14,
        padding: 15,
        paddingHorizontal: 16,
        marginTop: 12,
      }}>
      {title ? (
        <Text
          style={{
            fontFamily: 'Archivo',
            fontSize: 9.5,
            fontWeight: '600',
            letterSpacing: 0.14 * 9.5,
            textTransform: 'uppercase',
            color: '#77776F',
            marginBottom: 14,
          }}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}
