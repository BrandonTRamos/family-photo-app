// Where each Item's files live. Staging holds originals until processing succeeds; media holds what family members see.

export const mediaLayout = {
  /** The original as uploaded, in the staging bucket. */
  original: (itemId: string) => `uploads/${itemId}/original`,
  thumb: (itemId: string) => `items/${itemId}/thumb.jpg`,
  display: (itemId: string) => `items/${itemId}/display.jpg`,
  /** Folder the transcoder writes a video and its poster into. */
  videoFolder: (itemId: string) => `items/${itemId}/video/`,
};
