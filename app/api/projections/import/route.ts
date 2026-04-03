/**
 * POST /api/projections/import
 *
 * Admin-only. Accepts a Fangraphs projections CSV (text/plain body).
 * Query params:
 *   ?season=2026         (default 2026)
 *   ?system=Steamer      (default "Steamer")
 *   ?replace=1           (delete existing records for season+system before import)
 *
 * Matching strategy (Fangraphs ID → mlbID):
 *   1. Use MLBAMID column from CSV if present
 *   2. Fallback: match on normalized player name in the players collection
 *
 * Upsert key: { fgId, season, projSystem }
 */

import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';
import { parseFangraphsCsv, rowToProjection } from '@/app/lib/projection-utils';

function normalizeName(n: string): string {
  return n.toLowerCase().replace(/[^a-z ]/g, '').trim();
}

export async function POST(request: NextRequest) {
  try {
    const { isAdmin } = await getAdminAuthState();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const season = Number(request.nextUrl.searchParams.get('season') ?? 2026);
    const projSystem = request.nextUrl.searchParams.get('system') ?? 'Steamer';
    const replace = request.nextUrl.searchParams.get('replace') === '1';

    const csvText = await request.text();
    if (!csvText.trim()) {
      return NextResponse.json({ error: 'Request body must contain CSV text' }, { status: 400 });
    }

    const db = await connectToDatabase();

    // Parse CSV rows
    const rows = parseFangraphsCsv(csvText);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No rows parsed from CSV' }, { status: 400 });
    }

    // Build name → mlbID map from players collection for fallback matching
    const playerDocs = await db
      .collection('players')
      .find({}, { projection: { mlbID: 1, name: 1 } })
      .toArray();

    const nameToMlbId = new Map<string, string>();
    for (const p of playerDocs) {
      if (p.mlbID && p.name) {
        nameToMlbId.set(normalizeName(p.name), String(p.mlbID));
      }
    }

    if (replace) {
      await db.collection('projections').deleteMany({ season, projSystem });
    }

    const ops: any[] = [];
    let matched = 0;
    let unmatched = 0;
    let skipped = 0;

    for (const row of rows) {
      const proj = rowToProjection(row, season, projSystem);
      if (!proj) { skipped++; continue; }

      // Resolve mlbId: try MLBAMID column first, then name match
      const csvMlbId =
        row['MLBAMID'] || row['xMLBAMID'] || row['mlbamid'] || row['MLBID'] || '';
      let mlbId: string | null = csvMlbId ? String(csvMlbId).trim() : null;
      if (!mlbId || mlbId === '0') {
        mlbId = nameToMlbId.get(normalizeName(proj.name)) ?? null;
      }

      if (mlbId) matched++; else unmatched++;

      ops.push({
        updateOne: {
          filter: { fgId: proj.fgId, season, projSystem },
          update: {
            $set: {
              ...proj,
              mlbId,
              importedAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    }

    let upserted = 0;
    const BATCH = 500;
    for (let i = 0; i < ops.length; i += BATCH) {
      const r = await db
        .collection('projections')
        .bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
      upserted += r.upsertedCount + r.modifiedCount;
    }

    return NextResponse.json({
      ok: true,
      season,
      projSystem,
      rowsParsed: rows.length,
      skipped,
      matched,
      unmatched,
      upserted,
    });
  } catch (error) {
    console.error('projections/import error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Import failed' },
      { status: 500 },
    );
  }
}
