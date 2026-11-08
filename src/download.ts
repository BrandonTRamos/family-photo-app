// Getting a photo or video out of the app and onto the phone.

type Kind = 'photo' | 'video';

export interface SaveTarget {
  url: string;
  kind: Kind;
  /** Capture date (YYYY-MM-DD) or the item's id; used to name the file. */
  name: string;
}

async function fileFor({ url, kind, name }: SaveTarget): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not download this. Please try again.');
  const blob = await res.blob();
  const ext = kind === 'video' ? 'mp4' : 'jpg';
  return new File([blob], `family-${name}.${ext}`, { type: blob.type || (kind === 'video' ? 'video/mp4' : 'image/jpeg') });
}

/** Whether this phone or browser can hand files to its share sheet (where "Save Image" / "Save Video" live). */
export function canSaveToPhotos(): boolean {
  return typeof navigator.canShare === 'function' && typeof navigator.share === 'function';
}

/** Share sheet with the file in it: "Save Image" / "Save Video" puts it in Photos, other apps can take it too. */
export async function saveToPhotos(target: SaveTarget): Promise<void> {
  const file = await fileFor(target);
  if (!navigator.canShare?.({ files: [file] })) return saveFile(file);
  try {
    await navigator.share({ files: [file] });
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e; // closing the sheet is fine
  }
}

/** A normal download: lands in Files / Downloads on the phone. */
export async function saveToFiles(target: SaveTarget): Promise<void> {
  saveFile(await fileFor(target));
}

function saveFile(file: File): void {
  const link = document.createElement('a');
  const objectUrl = URL.createObjectURL(file);
  link.href = objectUrl;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
