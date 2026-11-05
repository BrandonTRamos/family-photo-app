// Capture dates are local calendar dates; format them in UTC so they never shift a day.
function utc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function monthName(month: string): string {
  return utc(`${month}-01`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
}

export function dayHeading(date: string, wide = false): string {
  return utc(date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: wide ? 'long' : 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function fullDate(date: string): string {
  return utc(date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function shortDate(date: string): string {
  return utc(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function duration(ms: number | undefined): string {
  if (!ms) return '';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function durationWords(ms: number | undefined): string {
  if (!ms) return '';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return [m && `${m} minute${m === 1 ? '' : 's'}`, s && `${s} second${s === 1 ? '' : 's'}`].filter(Boolean).join(' ');
}

export function items(n: number): string {
  return `${n} item${n === 1 ? '' : 's'}`;
}
