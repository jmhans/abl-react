const ABL_DATE_CUTOFF_HOURS_UTC = 8;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Derive the ABL scoring date from a timestamp using the project's 08:00Z-to-08:00Z day boundary.
 *
 * Example: `2025-08-06T01:38:00Z` => `2025-08-05`.
 */
export function deriveAblDate(gameDate: string | Date): string {
  const dt = new Date(gameDate);
  const shifted = new Date(dt.getTime() - ABL_DATE_CUTOFF_HOURS_UTC * 60 * 60 * 1000);

  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** True if the ABL date string (YYYY-MM-DD) falls on a day ABL games are played.
 *  ABL games run Tue/Wed/Fri/Sat/Sun — Mon and Thu are hard off-days. Evaluated at
 *  UTC noon to avoid DST ambiguity. */
export function isAblGameDay(ablDateStr: string): boolean {
  const dow = new Date(ablDateStr + 'T12:00:00Z').getUTCDay(); // 0=Sun, 1=Mon, 4=Thu
  return dow !== 1 && dow !== 4;
}

/**
 * Returns the next ABL date (YYYY-MM-DD) on/after `fromAblDateStr` that is a valid
 * game day. By default the starting date itself is not eligible (`inclusive: false`);
 * pass `inclusive: true` to allow `fromAblDateStr` itself if it's already a game day.
 */
export function nextAblGameDay(fromAblDateStr: string, options?: { inclusive?: boolean }): string {
  const inclusive = options?.inclusive ?? false;
  let cursor = new Date(fromAblDateStr + 'T12:00:00Z');
  if (!inclusive) cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);

  // Bounded loop — a valid game day is at most 3 calendar days away in the worst case
  // (Mon->Tue, Thu->Fri), 10 is a generous safety margin against a logic error here.
  for (let i = 0; i < 10; i++) {
    const candidate = `${cursor.getUTCFullYear()}-${pad2(cursor.getUTCMonth() + 1)}-${pad2(cursor.getUTCDate())}`;
    if (isAblGameDay(candidate)) return candidate;
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  throw new Error(`nextAblGameDay: no valid game day found within 10 days of ${fromAblDateStr}`);
}

/** Walks forward from `fromAblDateStr` and returns the next `count` valid ABL game
 *  days (inclusive of `fromAblDateStr` if it's itself a game day and `inclusive` is true). */
export function nextAblGameDays(fromAblDateStr: string, count: number, options?: { inclusive?: boolean }): string[] {
  const dates: string[] = [];
  let cursor = fromAblDateStr;
  let inclusive = options?.inclusive ?? false;
  for (let i = 0; i < count; i++) {
    cursor = nextAblGameDay(cursor, { inclusive });
    dates.push(cursor);
    inclusive = false; // subsequent lookups must always move forward from the found date
  }
  return dates;
}
