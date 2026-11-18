// Pictures the phone has already downloaded stay on it, in the service worker's cache.
//
// A picture's link changes about every hour (its signature does; see the CloudFront adapter), so the browser's own
// cache treats each new link as a new file and downloads it again. The service worker files pictures under the
// link without its signature, so one download serves every later link to the same picture.
//
// vite.config.ts writes the functions below into the service worker as text: each must stand alone, using nothing
// outside itself. Videos are left to the browser (they stream in ranges and are too big to keep).

export const PICTURE_CACHES = { thumbs: 'media-thumbs', display: 'media-display' } as const;

/** How many of each to keep; the least recently used go first. Thumbs are ~25 KB, display pictures ~500 KB. */
export const PICTURE_LIMITS = { thumbs: 3000, display: 60 } as const;

export const isThumb = ({ url }: { url: URL }): boolean =>
  url.searchParams.has('Key-Pair-Id') && url.pathname.endsWith('/thumb.jpg');

/** Display pictures and video posters. */
export const isPicture = ({ url }: { url: URL }): boolean =>
  url.searchParams.has('Key-Pair-Id') && url.pathname.endsWith('.jpg') && !url.pathname.endsWith('/thumb.jpg');

export const keepByPath = {
  /** File it under the link without its signature. */
  cacheKeyWillBeUsed: async ({ request }: { request: Request }): Promise<string> => {
    const url = new URL(request.url);
    return url.origin + url.pathname;
  },
  /**
   * A page's <img> asks without CORS, and that answer cannot be kept (the worker may not look inside it).
   * Ask with CORS instead, past the browser's own cache: a copy it kept from an <img> has no CORS headers.
   */
  requestWillFetch: async ({ request }: { request: Request }): Promise<Request> =>
    new Request(request.url, { mode: 'cors', credentials: 'omit', cache: 'no-store' }),
  /** Whatever goes wrong here, load the picture the way a page without a service worker would. */
  handlerDidError: async ({ request }: { request: Request }): Promise<Response> => fetch(request),
};

/** On sign-out: the pictures leave the phone with the person. */
export async function forgetPictures(): Promise<void> {
  if (typeof caches === 'undefined') return;
  await Promise.all(Object.values(PICTURE_CACHES).map((name) => caches.delete(name))).catch(() => undefined);
}

/** Whether pictures are being kept: the service worker is running this page. */
export function picturesKept(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
}
