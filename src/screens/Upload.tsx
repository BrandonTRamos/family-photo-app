import { useEffect, useRef, useState } from 'react';
import exifr from 'exifr';
import { PHOTO_TYPES, VIDEO_TYPES } from '../../core/api-types';
import { ErrorNotice, useApi, useLoad } from '../components';
import { duration, shortDate } from '../format';
import { CloseIcon, SparkleIcon, UploadIcon } from '../icons';
import { href } from '../router';

interface Selected {
  key: string;
  file: File;
  preview?: string;
  kind: 'photo' | 'video';
  fileDate?: string | null; // undefined while reading, null when none found
  chosenDate: string;
  settingDate: boolean;
  durationMs?: number;
  state: 'waiting' | 'sending' | 'done' | 'failed';
  progress: number;
  message?: string;
  itemId?: string;
}

const ACCEPT = [...PHOTO_TYPES, ...VIDEO_TYPES].join(',');

async function readFileDate(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const tags = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate'], reviveValues: false });
    const raw = (tags?.DateTimeOriginal ?? tags?.CreateDate) as string | undefined;
    const m = raw && /^(\d{4}):(\d{2}):(\d{2})/.exec(raw);
    return m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}` : null;
  } catch {
    return null;
  }
}

export function Upload() {
  const api = useApi();
  const albums = useLoad(() => api.albums(), []);
  const [files, setFiles] = useState<Selected[]>([]);
  const [albumId, setAlbumId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key: string, patch: Partial<Selected>) =>
    setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  function choose(list: FileList | null) {
    if (!list) return;
    const added: Selected[] = [...list].map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`,
      file,
      kind: file.type.startsWith('video/') ? 'video' : 'photo',
      preview: URL.createObjectURL(file),
      chosenDate: '',
      settingDate: false,
      state: 'waiting',
      progress: 0,
    }));
    setFiles((prev) => [...prev.filter((f) => f.state !== 'done'), ...added]);
    for (const f of added) {
      void readFileDate(f.file).then((fileDate) => update(f.key, { fileDate }));
      if (f.kind === 'video') {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => update(f.key, { durationMs: v.duration * 1000 });
        v.src = f.preview!;
      }
    }
    if (input.current) input.current.value = '';
  }

  async function send() {
    const waiting = files.filter((f) => f.state === 'waiting' || f.state === 'failed');
    if (!waiting.length) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.requestUploads({
        files: waiting.map((f) => ({ name: f.file.name, type: f.file.type, size: f.file.size, captureDate: f.chosenDate || undefined })),
        albumId: albumId || undefined,
      });
      await Promise.all(
        res.results.map(async (result, i) => {
          const f = waiting[i];
          if (!result.ok) return update(f.key, { state: 'failed', message: result.message });
          update(f.key, { state: 'sending', itemId: result.itemId });
          try {
            const parts = await api.sendFile(result.grant, f.file, (progress) => update(f.key, { progress }));
            await api.completeUpload(result.itemId, parts);
            update(f.key, { state: 'done', progress: 1 });
          } catch (e) {
            update(f.key, { state: 'failed', message: (e as Error).message });
          }
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pending = files.filter((f) => f.state === 'waiting' || f.state === 'failed').length;
  const done = files.filter((f) => f.state === 'done').length;

  return (
    <main className="page">
      <h1 className="page-title">Add photos &amp; videos</h1>

      <label className="choose">
        <UploadIcon size={28} />
        Choose from this device
        <span className="muted" style={{ fontSize: 15, fontWeight: 400 }}>
          Photos up to 50 MB, videos up to 2 GB
        </span>
        <input ref={input} type="file" multiple accept={ACCEPT} onChange={(e) => choose(e.target.files)} />
      </label>

      {files.length > 0 && (
        <section className="section">
          <h2 className="day" style={{ fontSize: 19 }}>
            {files.length} selected
          </h2>
          <ul className="file-list">
            {files.map((f) => (
              <li key={f.key} className="file-row">
                {f.kind === 'photo' ? <img className="thumb" src={f.preview} alt="" /> : <span className="thumb">Video</span>}
                <div className="info">
                  <strong>{f.kind === 'video' ? `Video${f.durationMs ? ` · ${duration(f.durationMs)}` : ''}` : 'Photo'}</strong>
                  <span className="muted">
                    {f.state === 'done'
                      ? 'Uploaded. It will appear on the Timeline shortly.'
                      : f.state === 'sending'
                        ? `Uploading… ${Math.round(f.progress * 100)}%`
                        : f.state === 'failed'
                          ? f.message
                          : f.fileDate
                            ? `Taken ${shortDate(f.fileDate)}`
                            : f.kind === 'video'
                              ? 'Date read after upload'
                              : f.fileDate === null
                                ? f.chosenDate
                                  ? `Date set: ${shortDate(f.chosenDate)}`
                                  : 'No date found'
                                : 'Reading date…'}
                  </span>
                </div>
                {f.state === 'waiting' && f.fileDate === null && f.kind === 'photo' && !f.settingDate && (
                  <button type="button" className="button small outline" onClick={() => update(f.key, { settingDate: true })}>
                    Set date
                  </button>
                )}
                {(f.state === 'waiting' || f.state === 'failed') && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${f.file.name}`}
                    onClick={() => setFiles((list) => list.filter((x) => x.key !== f.key))}
                  >
                    <CloseIcon />
                  </button>
                )}
                {f.settingDate && f.state === 'waiting' && (
                  <div className="field" style={{ flexBasis: '100%' }}>
                    <label htmlFor={`date-${f.key}`}>Exact date it was taken</label>
                    <input
                      id={`date-${f.key}`}
                      className="input"
                      type="date"
                      max={new Date().toISOString().slice(0, 10)}
                      value={f.chosenDate}
                      onChange={(e) => update(f.key, { chosenDate: e.target.value })}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="field">
        <label htmlFor="album">
          Add to an album <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
        </label>
        <select id="album" className="select" value={albumId} onChange={(e) => setAlbumId(e.target.value)}>
          <option value="">No album</option>
          {albums.data?.albums.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <p className="hint">
        <SparkleIcon />
        Tags are added to photos automatically after upload. You can change them anytime.
      </p>

      {error && <ErrorNotice message={error} />}
      {done > 0 && pending === 0 && !busy && (
        <p className="notice">
          Done. <a href={href({ name: 'timeline' })}>Back to the Timeline</a>
        </p>
      )}

      <button type="button" className="button block" disabled={busy || pending === 0} onClick={send}>
        {busy ? 'Uploading…' : pending ? `Upload ${pending} item${pending === 1 ? '' : 's'}` : 'Upload'}
      </button>
    </main>
  );
}
