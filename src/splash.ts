/** Tells the opening splash (in index.html) the app has something to show, so it can fade out. */
export function appReady(): void {
  window.dispatchEvent(new Event('app-ready'));
}
