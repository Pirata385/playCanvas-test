/** Sim-seconds per in-game day (8 real minutes at 1x). */
export const DAY_SECONDS = 480;
/** Fixed simulation step in sim-seconds. */
export const TICK_SECONDS = 0.1;
/** Hour of day at simulation time 0. */
export const START_HOUR = 7;

export function hourOfDay(time: number): number {
  return (START_HOUR + (time / DAY_SECONDS) * 24) % 24;
}

export function dayNumber(time: number): number {
  return Math.floor((START_HOUR + (time / DAY_SECONDS) * 24) / 24) + 1;
}

export function formatClock(time: number): string {
  const h = hourOfDay(time);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** True if `hour` lies in the (possibly wrapping) window [start, end). */
export function inHourWindow(hour: number, start: number, end: number): boolean {
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}
