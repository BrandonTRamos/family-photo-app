const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const TimelineIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" {...stroke}>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M3 9h18M8 2v4M16 2v4" />
  </svg>
);
export const AlbumsIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" {...stroke}>
    <rect x="3" y="7" width="14" height="14" rx="2" />
    <path d="M7 3h12a2 2 0 0 1 2 2v12" />
  </svg>
);
export const SearchIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" {...stroke}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </svg>
);
export const UploadIcon = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
    <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
  </svg>
);
export const BackIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" {...stroke} strokeWidth={2.4}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
export const ChevronIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} strokeWidth={2.4}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);
export const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} strokeWidth={2.4}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const PlayIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M6 3l15 9-15 9z" />
  </svg>
);
export const SparkleIcon = ({ label }: { label?: string }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="var(--accent)"
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
  >
    <path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4z" />
  </svg>
);
export const PlusIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeWidth={2.2}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const MoreIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
);
export const CalendarIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}>
    <rect x="3" y="4" width="18" height="17" rx="3" />
    <path d="M3 9h18M8 2v4M16 2v4M8 14h3" />
  </svg>
);
export const ShareIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" {...stroke}>
    <path d="M12 3v12M7 8l5-5 5 5" />
    <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </svg>
);
export const DownloadIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" {...stroke}>
    <path d="M12 4v11M7 11l5 5 5-5" />
    <path d="M5 20h14" />
  </svg>
);
export const PhotosIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" {...stroke}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4 18 5-5 4 4 3-3 4 4" />
  </svg>
);
export const FolderIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" {...stroke}>
    <path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
  </svg>
);
export const TrashIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" {...stroke}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3" />
  </svg>
);
export const AlbumAddIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" {...stroke}>
    <rect x="3" y="7" width="14" height="14" rx="2" />
    <path d="M7 3h12a2 2 0 0 1 2 2v12M10 11v6M7 14h6" />
  </svg>
);
export const ClearIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="currentColor" />
    <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="var(--print)" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
