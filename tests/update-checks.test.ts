/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchForUpdates } from '../src/update-checks';

describe('checking for a new deployment', () => {
  let page: EventTarget & { visibilityState: string };
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('document', page);
  });

  afterEach(() => {
    stop?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('checks every 30 minutes', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    stop = watchForUpdates({ update });
    await vi.advanceTimersByTimeAsync(30 * 60_000 - 1);
    expect(update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(update).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('checks when the app returns to the foreground', () => {
    const update = vi.fn().mockResolvedValue(undefined);
    stop = watchForUpdates({ update });
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    expect(update).not.toHaveBeenCalled();
    page.visibilityState = 'visible';
    page.dispatchEvent(new Event('visibilitychange'));
    expect(update).toHaveBeenCalledOnce();
  });

  it('keeps checking after an offline failure', async () => {
    const update = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(undefined);
    stop = watchForUpdates({ update });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('removes the timer and foreground listener on unmount', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    stop = watchForUpdates({ update });
    stop();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    page.dispatchEvent(new Event('visibilitychange'));
    expect(update).not.toHaveBeenCalled();
  });
});
