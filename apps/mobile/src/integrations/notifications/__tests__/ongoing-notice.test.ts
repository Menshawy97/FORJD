// 12B-1 (ADR-063). The typed seam over the local Android module that draws a ticking lock-screen notice.
// The Kotlin is walked on a phone; here the seam is tested against an injected fake: the shape it hands
// the module, the inputs it refuses, that it never throws, and that it is a no-op where the module is
// missing (Expo Go, iOS, Jest).
import {
  createOngoingNotice,
  ongoingNotice,
  toNativeOptions,
  type NoticeActionEvent,
  type OngoingNoticeNative,
  type OngoingNoticeOptions,
} from '../ongoing-notice';

const NOW = Date.UTC(2026, 9, 3, 18, 0, 0);

const restCard: OngoingNoticeOptions = {
  id: 'forjd-workout',
  channel: { id: 'workout-live', name: 'Workout in progress' },
  color: '#E9712F',
  title: 'REST',
  text: 'Next · Bench Press · 82.5 kg × 6',
  subText: 'Push Day · 32:10',
  chronometer: { countDownToMs: NOW + 90_000 },
  actions: [{ id: 'skip', title: 'Skip rest' }],
  then: {
    title: 'Bench Press',
    text: 'Set 3 of 4 · 82.5 kg × 6',
    subText: 'Push Day',
    chronometer: { countUpFromMs: NOW - 1_930_000 },
    actions: [{ id: 'done', title: 'Done' }],
  },
};

function fakeNative(over: Partial<OngoingNoticeNative> = {}) {
  let listener: ((event: NoticeActionEvent) => void) | null = null;
  const remove = jest.fn();
  const native: OngoingNoticeNative = {
    show: jest.fn().mockResolvedValue(true),
    dismiss: jest.fn(),
    takePendingActions: jest.fn().mockReturnValue([]),
    addListener: jest.fn((_event, next) => {
      listener = next;
      return { remove };
    }),
    ...over,
  };
  const emit = (event: unknown) => listener?.(event as NoticeActionEvent);
  return { native, emit, remove };
}

const notice = (native: OngoingNoticeNative | null) => createOngoingNotice(() => native, () => NOW);

describe('toNativeOptions', () => {
  it('flattens a rest card and its follow-up into the shape the module reads', () => {
    expect(toNativeOptions(restCard, NOW)).toEqual({
      id: 'forjd-workout',
      channelId: 'workout-live',
      channelName: 'Workout in progress',
      color: '#E9712F',
      visibility: 'public',
      title: 'REST',
      text: 'Next · Bench Press · 82.5 kg × 6',
      subText: 'Push Day · 32:10',
      countDownToMs: NOW + 90_000,
      countUpFromMs: null,
      actions: [{ id: 'skip', title: 'Skip rest', opensApp: false }],
      then: {
        title: 'Bench Press',
        text: 'Set 3 of 4 · 82.5 kg × 6',
        subText: 'Push Day',
        countDownToMs: null,
        countUpFromMs: NOW - 1_930_000,
        actions: [{ id: 'done', title: 'Done', opensApp: false }],
      },
    });
  });

  it('passes a private lock-screen view and app-opening actions through', () => {
    const native = toNativeOptions(
      { ...restCard, lockScreen: 'private', actions: [{ id: 'open', title: 'Open', opensApp: true }] },
      NOW,
    );
    expect(native?.visibility).toBe('private');
    expect(native?.actions).toEqual([{ id: 'open', title: 'Open', opensApp: true }]);
  });

  it('shows the follow-up straight away when the countdown has already ended', () => {
    const native = toNativeOptions({ ...restCard, chronometer: { countDownToMs: NOW - 1 } }, NOW);
    expect(native).toEqual(expect.objectContaining({ title: 'Bench Press', countDownToMs: null, then: null }));
    expect(native?.countUpFromMs).toBe(NOW - 1_930_000);
  });

  it('has no chronometer and no follow-up when none is given', () => {
    const plain = { ...restCard, chronometer: undefined, then: undefined };
    expect(toNativeOptions(plain, NOW)).toEqual(
      expect.objectContaining({ countDownToMs: null, countUpFromMs: null, then: null, subText: 'Push Day · 32:10' }),
    );
  });

  it.each<[string, Partial<OngoingNoticeOptions>]>([
    ['an empty id', { id: '' }],
    ['an empty channel id', { channel: { id: '', name: 'x' } }],
    ['an empty channel name', { channel: { id: 'x', name: ' ' } }],
    ['an empty title', { title: '' }],
    ['a colour that is not #RRGGBB', { color: 'ember' }],
    ['more than three actions', { actions: [1, 2, 3, 4].map((n) => ({ id: `a${n}`, title: `A${n}` })) }],
    ['two actions with one id', { actions: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] }],
    ['an action without a title', { actions: [{ id: 'a', title: '' }] }],
    ['a countdown that is not a finite time', { chronometer: { countDownToMs: Number.NaN } }],
    ['a count-up that is not a finite time', { chronometer: { countUpFromMs: Number.POSITIVE_INFINITY } }],
    ['a count-up that starts in the future', { then: undefined, chronometer: { countUpFromMs: NOW + 60_000 } }],
    ['a follow-up whose count-up starts in the future', { then: { title: 'x', text: 'y', chronometer: { countUpFromMs: NOW + 60_000 } } }],
    ['a follow-up without a countdown', { chronometer: { countUpFromMs: NOW } }],
    ['a follow-up that counts down itself', { then: { title: 'x', text: 'y', chronometer: { countDownToMs: NOW + 5 } } }],
    ['a follow-up with an empty title', { then: { title: '', text: 'y' } }],
  ])('refuses %s', (_label, change) => {
    expect(toNativeOptions({ ...restCard, ...change }, NOW)).toBeNull();
  });

  it('refuses an ended countdown with nothing to follow it', () => {
    expect(toNativeOptions({ ...restCard, then: undefined, chronometer: { countDownToMs: NOW } }, NOW)).toBeNull();
  });
});

describe('ongoing notice seam (12B-1)', () => {
  it('posts through the module and reports whether it showed', async () => {
    const { native } = fakeNative();

    await expect(notice(native).show(restCard)).resolves.toBe(true);

    expect(native.show).toHaveBeenCalledWith(toNativeOptions(restCard, NOW));
  });

  it('reports false when the module declines (notifications off)', async () => {
    const { native } = fakeNative({ show: jest.fn().mockResolvedValue(false) });
    await expect(notice(native).show(restCard)).resolves.toBe(false);
  });

  it('never hands the module invalid options', async () => {
    const { native } = fakeNative();
    await expect(notice(native).show({ ...restCard, color: 'red' })).resolves.toBe(false);
    expect(native.show).not.toHaveBeenCalled();
  });

  it('never throws when the module does', async () => {
    const { native } = fakeNative({
      show: jest.fn().mockRejectedValue(new Error('boom')),
      dismiss: jest.fn(() => {
        throw new Error('boom');
      }),
      takePendingActions: jest.fn(() => {
        throw new Error('boom');
      }),
    });
    const seam = notice(native);

    await expect(seam.show(restCard)).resolves.toBe(false);
    await expect(seam.dismiss('forjd-workout')).resolves.toBeUndefined();
    expect(() => seam.onAction(jest.fn())).not.toThrow();
  });

  it('dismisses by id', async () => {
    const { native } = fakeNative();
    await notice(native).dismiss('forjd-workout');
    expect(native.dismiss).toHaveBeenCalledWith('forjd-workout');
  });

  it('delivers action taps, then stops after unsubscribing', () => {
    const { native, emit, remove } = fakeNative();
    const handler = jest.fn();

    const unsubscribe = notice(native).onAction(handler);
    emit({ noticeId: 'forjd-workout', actionId: 'done' });
    unsubscribe();

    expect(handler).toHaveBeenCalledWith({ noticeId: 'forjd-workout', actionId: 'done' });
    expect(remove).toHaveBeenCalled();
  });

  it('hands over taps made while the app was not listening, in order, once someone listens', () => {
    const { native } = fakeNative({
      takePendingActions: jest.fn().mockReturnValue([
        { noticeId: 'forjd-workout', actionId: 'done' },
        { noticeId: 'forjd-workout', actionId: 'skip' },
      ]),
    });
    const handler = jest.fn();

    notice(native).onAction(handler);

    expect(handler.mock.calls).toEqual([
      [{ noticeId: 'forjd-workout', actionId: 'done' }],
      [{ noticeId: 'forjd-workout', actionId: 'skip' }],
    ]);
  });

  it('ignores malformed events from the module', () => {
    const { native, emit } = fakeNative({ takePendingActions: jest.fn().mockReturnValue([null, { noticeId: 1 }]) });
    const handler = jest.fn();

    notice(native).onAction(handler);
    emit({ noticeId: 'forjd-workout' });
    emit(undefined);

    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps delivering when a handler throws', () => {
    const { native, emit } = fakeNative();
    const handler = jest.fn(() => {
      throw new Error('boom');
    });

    notice(native).onAction(handler);
    emit({ noticeId: 'n', actionId: 'a' });
    emit({ noticeId: 'n', actionId: 'b' });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  describe('without the module (Expo Go, iOS, Jest)', () => {
    const seam = notice(null);

    it('says it is unavailable and does nothing', async () => {
      expect(seam.isAvailable()).toBe(false);
      await expect(seam.show(restCard)).resolves.toBe(false);
      await expect(seam.dismiss('forjd-workout')).resolves.toBeUndefined();
      const unsubscribe = seam.onAction(jest.fn());
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  it('looks the module up once, lazily', () => {
    const { native } = fakeNative();
    const load = jest.fn(() => native);
    const seam = createOngoingNotice(load, () => NOW);

    expect(load).not.toHaveBeenCalled();
    expect(seam.isAvailable()).toBe(true);
    seam.isAvailable();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('is a no-op in the app itself where the native module is not built in (here, Jest)', async () => {
    expect(ongoingNotice.isAvailable()).toBe(false);
    await expect(ongoingNotice.show(restCard)).resolves.toBe(false);
  });

  it('treats a module that fails to load as missing', () => {
    const seam = createOngoingNotice(() => {
      throw new Error('no native module');
    }, () => NOW);
    expect(seam.isAvailable()).toBe(false);
  });
});
