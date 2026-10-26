/**
 * Date and time formatting utilities adhering to workspace standards:
 * - GMT+8 timezone (Asia/Kuala_Lumpur)
 * - DD-MM-YY format for dates
 * - HH:mm:ss for times
 */

export function formatDateGmt8(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '—';

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
  return formatter.format(d).replace(/\//g, '-');
}

export function formatTimeGmt8(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '—';

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return formatter.format(d);
}
