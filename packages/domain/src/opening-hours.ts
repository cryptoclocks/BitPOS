// Weekly opening hours. Windows are same-day local times; overnight service is
// expressed as two windows on adjacent days, never as closes<opens.
export interface HoursWindow { opens: string; closes: string }
export type HoursWeek = Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', HoursWindow[]>;
export const maxWindowsPerDay = 4;
const clock = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export const emptyWeek = (): HoursWeek => ({ '0': [], '1': [], '2': [], '3': [], '4': [], '5': [], '6': [] });
export function validTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return value.length > 0 && value.length <= 64; } catch { return false; }
}
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
/** Returns a normalised week (sorted) or throws Error('INVALID_HOURS: reason'). */
export function normaliseWeek(input: unknown): HoursWeek {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_HOURS: week must be an object');
  const week = emptyWeek();
  for (const key of Object.keys(input)) if (!(key in week)) throw new Error(`INVALID_HOURS: unknown day ${key}`);
  for (const day of Object.keys(week) as (keyof HoursWeek)[]) {
    const raw = (input as Record<string, unknown>)[day] ?? [];
    if (!Array.isArray(raw) || raw.length > maxWindowsPerDay) throw new Error(`INVALID_HOURS: day ${day} has too many windows`);
    const windows = raw.map(item => {
      if (!item || typeof item !== 'object') throw new Error(`INVALID_HOURS: day ${day} window malformed`);
      const { opens, closes, ...extra } = item as Record<string, unknown>;
      if (Object.keys(extra).length || typeof opens !== 'string' || typeof closes !== 'string' || !clock.test(opens) || !clock.test(closes)) throw new Error(`INVALID_HOURS: day ${day} times must be HH:MM`);
      if (minutes(opens) >= minutes(closes)) throw new Error(`INVALID_HOURS: day ${day} must open before it closes`);
      return { opens, closes };
    }).sort((a, b) => minutes(a.opens) - minutes(b.opens));
    for (let i = 1; i < windows.length; i++) if (minutes(windows[i].opens) < minutes(windows[i - 1].closes)) throw new Error(`INVALID_HOURS: day ${day} windows overlap`);
    week[day] = windows;
  }
  return week;
}
/** Local weekday/time in the merchant zone; weekday 0 = Sunday. */
export function localParts(at: Date, timeZone: string): { weekday: keyof HoursWeek; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  const weekday = String(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))) as keyof HoursWeek;
  return { weekday, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}
export function isOpenAt(week: HoursWeek, timeZone: string, at: Date): boolean {
  const { weekday, minutes: now } = localParts(at, timeZone);
  return week[weekday].some(w => minutes(w.opens) <= now && now < minutes(w.closes));
}
