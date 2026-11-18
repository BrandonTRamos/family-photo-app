// The list a photo was opened from, in the order shown, so the photo screen can move to the one before or after.
//
// Each screen with a grid of photos (the Timeline, an album, search results, Undated) says what it is showing.
// Only the latest list is kept, with the screen it belongs to: the photo screen uses it only when that is the
// screen its Back button returns to. Opened any other way (a shared link, a refresh) a photo stands alone.
//
// A list holds what its screen had loaded, which may not be all of it (lists load a page at a time):
// moving through photos stops at the last one loaded.
import type { ItemSummaryDto } from '../core/api-types';
import { href, type Route } from './router';

let shown: { screen: string; items: ItemSummaryDto[] } | undefined;

export function showingPhotos(screen: Route, items: ItemSummaryDto[]): void {
  shown = { screen: href(screen), items };
}

/** The list `id` was opened from and its place in it, when it was opened from the list `screen` shows. */
export function photosAround(screen: Route, id: string): { items: ItemSummaryDto[]; index: number } | undefined {
  if (shown?.screen !== href(screen)) return undefined;
  const index = shown.items.findIndex((i) => i.id === id);
  return index < 0 ? undefined : { items: shown.items, index };
}
