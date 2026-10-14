// 12A-3. The text of the live run notice on Android, pinned to the approved replica v2 (2026-10-03):
// header "FORJD · Run" (or "Run paused"), title "24:31 · 4.82 km", text "Avg pace 5:05 /km", and the
// actions Pause (Resume when paused) and Finish. The numbers use the run screen's own formats.
import { runNotificationContent } from '../run-notification-content';

const stats = (movingSeconds: number, distanceMeters: number, averagePaceSecondsPerKm: number | null) => ({
  movingSeconds,
  distanceMeters,
  averagePaceSecondsPerKm,
});

describe('runNotificationContent', () => {
  it('matches the approved replica while running', () => {
    expect(runNotificationContent(stats(1471, 4820, 305), 'running')).toEqual({
      header: 'Run',
      title: '24:31 · 4.82 km',
      body: 'Avg pace 5:05 /km',
      category: 'run-running',
    });
  });

  // Runs in miles (docs/product/run-miles-plan.md, replica approved 2026-10-14).
  it('reads in miles when Units is miles', () => {
    expect(runNotificationContent(stats(1471, 4828.032, 305), 'running', 'mi')).toMatchObject({
      title: '24:31 · 3.00 mi',
      body: 'Avg pace 8:11 /mi',
    });
  });

  it('says paused, and offers Resume instead of Pause, while paused', () => {
    expect(runNotificationContent(stats(1471, 4820, 305), 'paused')).toEqual({
      header: 'Run paused',
      title: '24:31 · 4.82 km',
      body: 'Avg pace 5:05 /km',
      category: 'run-paused',
    });
  });

  it('shows a dash for pace before there is one, like the run screen', () => {
    expect(runNotificationContent(stats(5, 0, null), 'running').body).toBe('Avg pace — /km');
  });

  it('shows hours once a run passes an hour', () => {
    expect(runNotificationContent(stats(3725, 12340, 302), 'running').title).toBe('1:02:05 · 12.34 km');
  });

  it('carries no health value: no heart rate and no calories, even when the run has them', () => {
    const content = runNotificationContent(
      { ...stats(600, 2000, 300), avgHeartRateBpm: 151, caloriesKcal: 210 } as never,
      'running',
    );

    expect(JSON.stringify(content)).not.toMatch(/151|210|bpm|kcal/);
  });
});
