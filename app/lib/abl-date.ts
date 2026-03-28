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
