import type { AthleteRecord, AthleteSession, AthleteStats } from '@forjd/contracts';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { colors } from '@/theme/tokens';
import { recordValue, sessionLabel, sessionValue } from './athlete-format';

/**
 * The parts of the athlete profile below the identity row, transcribed from `s_athlete()` in the
 * prototype (`FORJD Mobile.dc.html`, and `public profile.png`):
 *
 * - stat tile: `flex:1`, `#17181A` fill, `.07` outline, `borderRadius:13`, `padding:'13px 12px'`,
 *   centred; value `700 19px/1` accent tabular, label `600 9px/1` `.1em` uppercase at
 *   `marginTop:7`, optional sub-label `400 10px/1` at `marginTop:6`. The row has `gap:8` and
 *   `marginTop:18`.
 * - section label: `600 9.5px/1` `.14em` uppercase, `margin:'26px 0 2px'`.
 * - list row: `space-between`, `gap:12`, `padding:'13px 2px'`, a `.05` rule underneath; left
 *   `600 13.5px/1.2`, right `700 13.5px/1` tabular, accent for a record and `#c8c8c0` for a session.
 * - footnote card: `padding:'13px 14px'`, `marginTop:24`, a shield glyph and `400 12px/1.5` copy.
 *
 * The prototype's faint grey on the tile and section labels was retired for readability in 8H,
 * so they take `label`. Every value shown is the server's.
 */

const SECTION_LABEL = {
  fontFamily: 'Archivo',
  fontSize: 9.5,
  lineHeight: 9.5,
  fontWeight: '600',
  letterSpacing: 0.14 * 9.5,
  textTransform: 'uppercase',
  color: colors.label,
} as const;

function SectionLabel({ children }: { children: string }) {
  return <Text style={{ ...SECTION_LABEL, marginTop: 26, marginBottom: 2 }}>{children}</Text>;
}

interface TileProps {
  label: string;
  value: string;
  sub?: string;
}

function Tile({ label, value, sub }: TileProps) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 13,
        paddingVertical: 13,
        paddingHorizontal: 12,
      }}>
      <Text
        style={{
          fontFamily: 'Archivo',
          fontSize: 19,
          lineHeight: 19,
          fontWeight: '700',
          color: colors.accent,
          fontVariant: ['tabular-nums'],
        }}>
        {value}
      </Text>
      <Text
        style={{
          marginTop: 7,
          fontFamily: 'Archivo',
          fontSize: 9,
          lineHeight: 9,
          fontWeight: '600',
          letterSpacing: 0.1 * 9,
          textTransform: 'uppercase',
          color: colors.label,
        }}>
        {label}
      </Text>
      {sub ? (
        <Text
          style={{
            marginTop: 6,
            fontFamily: 'Archivo',
            fontSize: 10,
            lineHeight: 10,
            fontWeight: '400',
            color: colors.dimmer,
          }}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/** City rank, score and streak. Only drawn for an athlete who is ranked this month. */
export function StatTiles({ stats }: { stats: AthleteStats }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 18 }}>
      <Tile label="City rank" value={`#${stats.cityRank}`} />
      <Tile label="Score" value={stats.score.toFixed(1)} />
      <Tile label="Streak" value={String(stats.streakWeeks)} sub="weeks" />
    </View>
  );
}

interface RowProps {
  label: string;
  value: string;
  accent?: boolean;
}

function ListRow({ label, value, accent = false }: RowProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 13,
        paddingHorizontal: 2,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderFaint,
      }}>
      <Text
        style={{
          flexShrink: 1,
          minWidth: 0,
          fontFamily: 'Archivo',
          fontSize: 13.5,
          lineHeight: 13.5 * 1.2,
          fontWeight: '600',
          color: colors.text,
        }}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: 'Archivo',
          fontSize: 13.5,
          lineHeight: 13.5,
          fontWeight: '700',
          color: accent ? colors.accent : colors.textSecondary,
          fontVariant: ['tabular-nums'],
        }}>
        {value}
      </Text>
    </View>
  );
}

/** Up to four heaviest lifts. Not drawn at all when there are none. */
export function PersonalRecords({ records }: { records: AthleteRecord[] }) {
  if (records.length === 0) return null;
  return (
    <View>
      <SectionLabel>Personal records</SectionLabel>
      {records.map((record) => (
        <ListRow key={record.exerciseName} label={record.exerciseName} value={recordValue(record)} accent />
      ))}
    </View>
  );
}

/** Up to three newest sessions. Not drawn at all when there are none. */
export function RecentSessions({ sessions }: { sessions: AthleteSession[] }) {
  if (sessions.length === 0) return null;
  return (
    <View>
      <SectionLabel>Recent sessions</SectionLabel>
      {sessions.map((session) => (
        <ListRow
          key={`${session.name}-${session.startedAt}`}
          label={sessionLabel(session)}
          value={sessionValue(session)}
        />
      ))}
    </View>
  );
}

/** What is never public. It is the promise the API's response shape keeps. */
export function PrivacyNote() {
  return (
    <View
      style={{
        marginTop: 24,
        flexDirection: 'row',
        gap: 11,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 14,
        paddingVertical: 13,
        paddingHorizontal: 14,
      }}>
      <View style={{ marginTop: 1 }}>
        <Icon name="shield" size={18} color={colors.metadata} />
      </View>
      <Text
        style={{
          flex: 1,
          fontFamily: 'Archivo',
          fontSize: 12,
          lineHeight: 12 * 1.5,
          fontWeight: '400',
          color: colors.dimmer,
        }}>
        Rank, records and sessions only. Sleep, HRV, body composition and InBody scans are never
        public.
      </Text>
    </View>
  );
}
