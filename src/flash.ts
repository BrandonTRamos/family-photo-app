// A one-time message carried to the next screen, e.g. "moved to Recently deleted" after leaving a deleted photo.

export interface Flash {
  deleted: { id: string; kind: 'photo' | 'video' };
}

let pending: Flash | undefined;

export function setFlash(flash: Flash): void {
  pending = flash;
}

/** Returns the message once, then forgets it. */
export function takeFlash(): Flash | undefined {
  const flash = pending;
  pending = undefined;
  return flash;
}
