import { act, renderHook } from '@testing-library/react-native';

import { useSingleFlight } from '../use-single-flight';

/**
 * Whole-app review 8.5, L4-1: tapping "Add to Log" twice while the first save was still in flight
 * logged the food twice. `useSingleFlight` lets a save button run its task once at a time.
 */
describe('useSingleFlight', () => {
  function deferred() {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it('runs a task once when it is started again before the first finishes', async () => {
    const save = deferred();
    const task = jest.fn(() => save.promise);
    const { result } = await renderHook(() => useSingleFlight());

    await act(async () => {
      const first = result.current.run(task);
      const second = result.current.run(task);
      expect(task).toHaveBeenCalledTimes(1);
      save.resolve();
      await Promise.all([first, second]);
    });

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('reports that it is running while the task is in flight, and not after', async () => {
    const save = deferred();
    const { result } = await renderHook(() => useSingleFlight());
    let pending: Promise<void> = Promise.resolve();

    await act(async () => {
      pending = result.current.run(() => save.promise);
    });
    expect(result.current.isRunning).toBe(true);

    await act(async () => {
      save.resolve();
      await pending;
    });
    expect(result.current.isRunning).toBe(false);
  });

  it('allows the next run once the first has finished', async () => {
    const task = jest.fn(async () => undefined);
    const { result } = await renderHook(() => useSingleFlight());

    await act(async () => {
      await result.current.run(task);
      await result.current.run(task);
    });

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('releases after a failure, and passes the error on to the caller', async () => {
    const { result } = await renderHook(() => useSingleFlight());
    const failing = jest.fn(async () => {
      throw new Error('offline');
    });

    await act(async () => {
      await expect(result.current.run(failing)).rejects.toThrow('offline');
    });
    expect(result.current.isRunning).toBe(false);

    const next = jest.fn(async () => undefined);
    await act(async () => {
      await result.current.run(next);
    });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
