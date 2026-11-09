const CHECK_EVERY_MS = 30 * 60_000;

/** Match Command Center: check periodically and whenever the app returns to the foreground. */
export function watchForUpdates(registration: { update(): Promise<unknown> }): () => void {
  const check = () => {
    // Going offline must not interrupt the app or prevent the next check.
    void registration.update().catch(() => undefined);
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') check();
  };
  const timer = setInterval(check, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
