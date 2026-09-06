import { Text, View } from 'react-native';

import type { TrainingCalendar as TrainingCalendarData } from '@forjd/contracts';

/**
 * "Training calendar" -- `progress strength.png`'s month grid, transcribed from the
 * prototype's `calVals()` (`FORJD Mobile.dc.html:3368`).
 *
 * The API sends only the days that were actually trained (`TrainingCalendarDay[]`); this
 * component is what expands that into a full Monday-first month grid with leading blanks for
 * the days before the 1st and rest cells for every other day, exactly as `calVals()` builds
 * `calDays` from its own `trained` map. There are no trailing blanks -- the grid ends with the
 * month's last day, the same asymmetry the prototype's own loop has.
 */
interface TrainingCalendarProps {
  data: TrainingCalendarData;
  /** Today's date, `YYYY-MM-DD` in the viewer's own zone -- draws the ring around today's cell. */
  today: string;
}

const WEEKDAY_HEADS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const CELL_SIZE = 30;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function daysInMonth(year: number, monthIndexZeroBased: number): number {
  return new Date(Date.UTC(year, monthIndexZeroBased + 1, 0)).getUTCDate();
}

/** Monday-first weekday of the 1st: 0 for Monday through 6 for Sunday. */
function leadingBlanks(year: number, monthIndexZeroBased: number): number {
  const sundayFirst = new Date(Date.UTC(year, monthIndexZeroBased, 1)).getUTCDay();
  return (sundayFirst + 6) % 7;
}

export function TrainingCalendar({ data, today }: TrainingCalendarProps) {
  const [yearStr, monthStr] = data.month.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const total = daysInMonth(year, monthIndex);
  const lead = leadingBlanks(year, monthIndex);
  const activityByDate = new Map(data.days.map((day) => [day.date, day.activity]));

  const cells: { date: string | null; day: number | null }[] = [
    ...Array.from({ length: lead }, () => ({ date: null, day: null })),
    ...Array.from({ length: total }, (_, index) => {
      const day = index + 1;
      const date = `${yearStr}-${monthStr}-${String(day).padStart(2, '0')}`;
      return { date, day };
    }),
  ];

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
        <Text
          style={{
            fontFamily: 'Archivo',
            fontSize: 9.5,
            fontWeight: '600',
            letterSpacing: 0.14 * 9.5,
            textTransform: 'uppercase',
            color: '#77776F',
          }}>
          {`Training calendar — ${MONTH_NAMES[monthIndex]}`}
        </Text>
        <Text
          style={{
            fontFamily: 'Archivo',
            fontSize: 11,
            fontWeight: '600',
            color: '#E9712F',
            fontVariant: ['tabular-nums'],
          }}>
          {`${data.daysTrained} ${data.daysTrained === 1 ? 'day' : 'days'} trained`}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
        {WEEKDAY_HEADS.map((head, index) => (
          <Text
            key={`head-${index}`}
            style={{
              width: `${100 / 7}%`,
              textAlign: 'center',
              fontFamily: 'Archivo',
              fontSize: 9,
              fontWeight: '600',
              letterSpacing: 0.06 * 9,
              color: '#5C5C55',
              paddingBottom: 2,
            }}>
            {head}
          </Text>
        ))}
        {cells.map((cell, index) => {
          if (cell.date === null) {
            return <View key={`blank-${index}`} style={{ width: `${100 / 7}%`, height: CELL_SIZE }} />;
          }
          const activity = activityByDate.get(cell.date);
          const isToday = cell.date === today;
          const background =
            activity === 'strength' ? '#E9712F' : activity === 'run' ? '#79B98A' : '#1A1B1D';
          const color = activity === 'strength' ? '#FFFFFF' : activity === 'run' ? '#101011' : '#77776F';

          return (
            <View
              key={cell.date}
              accessible
              accessibilityRole="text"
              accessibilityLabel={
                activity === undefined
                  ? `${cell.date}, rest day`
                  : `${cell.date}, ${activity === 'run' ? 'run' : 'strength'} day`
              }
              style={{
                width: `${100 / 7}%`,
                height: CELL_SIZE,
                borderRadius: 7,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: background,
                borderWidth: 1.5,
                borderColor: isToday ? '#F6F5F3' : 'transparent',
              }}>
              <Text
                style={{
                  fontFamily: 'Archivo',
                  fontSize: 11,
                  fontWeight: activity === undefined ? '500' : '700',
                  color,
                  fontVariant: ['tabular-nums'],
                }}>
                {cell.day}
              </Text>
            </View>
          );
        })}
      </View>

      <View
        style={{
          flexDirection: 'row',
          gap: 14,
          marginTop: 14,
          paddingTop: 12,
          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,.06)',
        }}>
        {[
          { label: 'Strength', color: '#E9712F' },
          { label: 'Run', color: '#79B98A' },
          // The prototype's own legend swatch (`#26272A`) does not match the rest cell's own
          // fill (`#1A1B1D`) -- a mismatch in the design itself, reproduced here for fidelity
          // rather than "corrected" against a screenshot that shows the same discrepancy.
          { label: 'Rest', color: '#26272A' },
        ].map((legend) => (
          <View key={legend.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: legend.color }} />
            <Text style={{ fontFamily: 'Archivo', fontSize: 10.5, fontWeight: '500', color: '#77776F' }}>
              {legend.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
