// Like a native app, each screen keeps its scroll position: back from a photo lands exactly where you were,
// and switching tabs returns to the same spot.
import { useLayoutEffect } from 'react';

const positions = new Map<string, number>();
let current = '';
let started = false;

function start(): void {
  if (started) return;
  started = true;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  let frame = 0;
  window.addEventListener(
    'scroll',
    () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        positions.set(current, window.scrollY);
      });
    },
    { passive: true },
  );
}

/** Call once per screen with a key for it (its link). Runs after the screen has drawn what it already has. */
export function useScrollMemory(key: string): void {
  useLayoutEffect(() => {
    start();
    current = key;
    const target = positions.get(key) ?? 0;
    jump(target);
    if (target === 0) return;
    // The screen may still be filling in (images, a background refresh): try once more if nobody has scrolled.
    const landed = window.scrollY;
    const again = setTimeout(() => {
      if (current === key && window.scrollY === landed && landed !== target) jump(target);
    }, 300);
    return () => clearTimeout(again);
  }, [key]);
}

/** Jump, never glide: restoring a position should look like the screen never left. */
function jump(top: number): void {
  window.scrollTo({ top, behavior: 'instant' });
}
