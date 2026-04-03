/**
 * projection-utils.ts
 *
 * Shared helpers for Fangraphs projection CSV parsing and ABL score
 * calculation from projected stats.
 *
 * ABL scoring formula (same as calculateDraftAblScore in draft-utils.ts):
 *   points = H*25 + 2B*10 + 3B*20 + HR*30 + BB*10 + HBP*10
 *            + SB*7 + CS*(-7) + (SH+SF)*5
 *   ablScore = points / AB - 4.5
 */

export type ProjectionStats = {
  g: number;
  pa: number;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  bb: number;
  hbp: number;
  sb: number;
  cs: number;
  sacBunts: number;
  sacFlies: number;
};

export type ProjectionRecord = {
  fgId: string;
  mlbId: string | null;
  name: string;
  team: string;
  season: number;
  projSystem: string;
  stats: ProjectionStats;
  ablProjected: number;
  importedAt: Date;
};

/** Calculate ABL projected score from projection stats. Returns 0 if no AB. */
export function calculateAblProjected(stats: ProjectionStats): number {
  if (!stats || stats.ab <= 0) return 0;
  const points =
    stats.h * 25 +
    stats.doubles * 10 +
    stats.triples * 20 +
    stats.hr * 30 +
    stats.bb * 10 +
    stats.hbp * 10 +
    stats.sb * 7 +
    stats.cs * -7 +
    (stats.sacBunts + stats.sacFlies) * 5;
  return points / stats.ab - 4.5;
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse a Fangraphs projections CSV string.
 *
 * Fangraphs exports use these column names (case-insensitive):
 *   playerid, Name, Team, G, PA, AB, H, 1B, 2B, 3B, HR, BB (or uBB),
 *   HBP, SF, SH, SB, CS, MLBAMID (sometimes present)
 *
 * Returns an array of raw rows as record<string, string> — caller is
 * responsible for upsert / matching.
 */
export function parseFangraphsCsv(csvText: string): Array<Record<string, string>> {
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  // Parse CSV with quoted-field support
  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        fields.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    return fields;
  }

  const headers = parseLine(lines[0]).map((h) => h.replace(/^"|"$/g, '').trim());

  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

/**
 * Find a column value case-insensitively, checking multiple candidate names.
 */
function col(row: Record<string, string>, ...candidates: string[]): string {
  for (const c of candidates) {
    const key = Object.keys(row).find((k) => k.toLowerCase() === c.toLowerCase());
    if (key !== undefined) return row[key] ?? '';
  }
  return '';
}

/**
 * Convert a parsed CSV row into a ProjectionRecord (minus mlbId and importedAt
 * which are resolved at import time).
 */
export function rowToProjection(
  row: Record<string, string>,
  season: number,
  projSystem: string,
): Omit<ProjectionRecord, 'mlbId' | 'importedAt'> | null {
  const fgId = col(row, 'playerid');
  const name = col(row, 'name');
  const team = col(row, 'team');
  if (!fgId || !name) return null;

  const stats: ProjectionStats = {
    g: toNum(col(row, 'g')),
    pa: toNum(col(row, 'pa')),
    ab: toNum(col(row, 'ab')),
    h: toNum(col(row, 'h')),
    doubles: toNum(col(row, '2b')),
    triples: toNum(col(row, '3b')),
    hr: toNum(col(row, 'hr')),
    bb: toNum(col(row, 'bb', 'ubb')),
    hbp: toNum(col(row, 'hbp')),
    sb: toNum(col(row, 'sb')),
    cs: toNum(col(row, 'cs')),
    sacBunts: toNum(col(row, 'sh')),
    sacFlies: toNum(col(row, 'sf')),
  };

  // Must have projected ABs to be useful
  if (stats.ab <= 0) return null;

  return {
    fgId,
    name,
    team,
    season,
    projSystem,
    stats,
    ablProjected: calculateAblProjected(stats),
  };
}
