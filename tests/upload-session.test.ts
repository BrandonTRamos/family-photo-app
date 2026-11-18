import { describe, expect, it } from 'vitest';
import { ApiError, type ApiClient } from '../src/api';
import type { UploadGrantDto } from '../core/api-types';
import { UploadSession } from '../src/upload-session';

const grant = { mode: 'single', url: 'https://storage.test/put', headers: {} } as UploadGrantDto;
const photo = { key: 'a', file: new File(['x'], 'a.jpg', { type: 'image/jpeg' }) };

function sessionWith(api: Partial<ApiClient>) {
  return new UploadSession({
    requestUploads: async () => ({ results: [{ ok: true, name: 'a.jpg', itemId: 'item-1', grant }] }),
    sendFile: async () => undefined,
    completeUpload: async () => ({ status: 'processing' }),
    ...api,
  } as ApiClient);
}

describe('when an upload fails', () => {
  it('explains a storage or connection failure in plain words, not a status code', async () => {
    const session = sessionWith({
      sendFile: async () => {
        throw new Error('Upload failed (500)');
      },
    });
    const [outcome] = await session.send([photo], undefined, () => {});
    expect(outcome).toMatchObject({ ok: false, message: "This didn't go through. Check your connection and try again." });
  });

  it("passes on the Archive's own message", async () => {
    const session = sessionWith({
      completeUpload: async () => {
        throw new ApiError(403, 'not_a_member', 'Ask a family member to add you to the Archive.');
      },
    });
    const [outcome] = await session.send([photo], undefined, () => {});
    expect(outcome).toMatchObject({ ok: false, message: 'Ask a family member to add you to the Archive.' });
  });
});
