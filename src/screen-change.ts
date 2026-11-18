// How one screen gives way to the next.
//
// A photo grows out of the tile that was tapped, and shrinks back into its tile on the way out: the browser's
// View Transitions. Every other change, and every browser without view transitions, uses the .page animations
// in styles.css, which read <html data-nav>: 'forward', 'back', or 'off' when something else is already animating
// the change. Only one of the two ever runs. With prefers-reduced-motion neither does (styles.css turns .page's off).

export interface ScreenChange {
  move: 'forward' | 'back';
  /** Link of the photo being opened, if one is. */
  opens?: string;
  /** Link of the photo being left, if one is. */
  closes?: string;
  /** The photo being left is not the one that was opened: it was reached by swiping. */
  swiped?: boolean;
  /** The browser has already animated this change itself (a swipe-back gesture): add nothing. */
  shown?: boolean;
}

/** The name the tile and the photo share during a transition; styles.css gives it to the photo and shapes the move. */
const NAME = 'photo';
const PICTURE_LINKS = 'a.print, a.hero';

/** The picture link last tapped: a list can show the same photo twice (the Timeline's opening photo and its tile). */
let tapped: Element | undefined;

/** Start noticing which picture is tapped. Returns how to stop. */
export function watchTaps(): () => void {
  const onClick = (e: MouseEvent) => {
    tapped = (e.target as Element).closest?.(PICTURE_LINKS) ?? undefined;
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}

/** Show the next screen (`apply` draws it, synchronously) with the animation that suits the change. */
export function changeScreen(change: ScreenChange, apply: () => void): void {
  const html = document.documentElement;
  const show = (nav: 'forward' | 'back' | 'off') => {
    html.dataset.nav = nav;
    apply();
    return change.closes ? tileFor(change.closes, !!change.swiped) : undefined;
  };

  if (change.shown) return void show('off');
  const from = change.opens ? linksTo(change.opens).find((a) => a === tapped || onScreen(a)) : undefined;
  const morphs = from || (change.closes && !change.opens);
  if (!morphs || !canMorph()) return void show(change.move);

  from?.style.setProperty('view-transition-name', NAME);
  let into: HTMLElement | undefined;
  let undraw: (() => void) | undefined;
  // The old screen is pictured first, then this runs. data-nav changes only in here, with the old screen about to
  // go: changed any sooner, the old screen would restart its own animation and be pictured mid-way through it.
  const transition = document.startViewTransition(() => {
    into = show('off');
    into?.style.setProperty('view-transition-name', NAME);
    undraw = into && drawNow(into);
    // Leaving a photo whose tile is not on the new screen: nothing to shrink into, so animate as any other change.
    if (!from && !into) {
      html.dataset.nav = change.move;
      transition.skipTransition();
    }
  });
  transition.ready.catch(() => undefined); // skipped (above, or the tab is hidden): the screen has changed anyway
  void transition.finished.finally(() => {
    from?.style.removeProperty('view-transition-name');
    into?.style.removeProperty('view-transition-name');
    undraw?.();
  });
}

/**
 * The Timeline leaves each month undrawn until the browser has seen it is on screen (content-visibility), which is
 * a moment after it appears, and a transition leaves out what is not drawn. Have the tile's part drawn at once.
 * Returns how to hand the decision back to the browser.
 */
function drawNow(tile: HTMLElement): () => void {
  const held: HTMLElement[] = [];
  for (let el = tile.parentElement; el; el = el.parentElement) {
    if (getComputedStyle(el).contentVisibility !== 'auto') continue;
    el.style.setProperty('content-visibility', 'visible');
    held.push(el);
  }
  return () => held.forEach((el) => el.style.removeProperty('content-visibility'));
}

function canMorph(): boolean {
  return typeof document.startViewTransition === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The tile on the screen just drawn for the photo just left, if it can be seen. After swiping, that photo may be
 * anywhere in the list: bring it into view first, so the list shows the photo last looked at. This runs after the
 * screen's remembered scroll position is restored (scroll.ts) and moves only when the tile is not already in full view.
 */
function tileFor(link: string, swiped: boolean): HTMLElement | undefined {
  const links = linksTo(link);
  const tile = links.find((a) => a.classList.contains('print'));
  if (swiped && tile && !inFullView(tile)) tile.scrollIntoView({ block: 'center', behavior: 'instant' });
  return links.find(onScreen);
}

function linksTo(link: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(PICTURE_LINKS)].filter((a) => a.getAttribute('href') === link);
}

function onScreen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

/** Wholly between the bar at the top and the tabs at the bottom. */
function inFullView(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const bar = document.querySelector('.navbar')?.getBoundingClientRect();
  const tabs = document.querySelector('.tabbar')?.getBoundingClientRect();
  const top = bar ? Math.max(0, bar.bottom) : 0;
  const bottom = tabs?.height ? tabs.top : window.innerHeight;
  return r.top >= top && r.bottom <= bottom;
}
