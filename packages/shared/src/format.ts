export function formatClock(seconds: number): string {
  const trunc = Math.trunc(seconds);
  const sign = trunc < 0 ? '-' : '';
  const abs = Math.abs(trunc);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}:${String(s).padStart(2, '0')}`;
}
