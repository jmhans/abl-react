import { NextRequest } from 'next/server';
import { MongoClient } from 'mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';

const PROD_DB = 'heroku_wm40bx9r';
const DEV_DB  = 'abl_dev';
const BATCH_SIZE = 1000;
const DEFAULT_DELTA_HOURS = 24;
const TIMESTAMP_FIELDS = ['updatedAt', 'lastUpdate', 'modifiedAt', 'createdAt', 'importedAt', 'gameDate'] as const;

export const dynamic = 'force-dynamic';
// Long-running sync — give it up to 5 minutes before Vercel kills it
export const maxDuration = 300;

type SyncMode = 'full' | 'delta';

function parseCollectionList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

async function detectTimestampField(prodCol: any): Promise<string | null> {
  for (const field of TIMESTAMP_FIELDS) {
    const found = await prodCol.findOne(
      { [field]: { $exists: true, $ne: null } },
      { projection: { _id: 1 } }
    );
    if (found) return field;
  }
  return null;
}

async function fullCopyCollection(prodCol: any, devCol: any): Promise<number> {
  // Drop dev collection first (ignore "ns not found" = code 26)
  try {
    await devCol.drop();
  } catch (e: any) {
    if (e?.code !== 26) throw e;
  }

  const cursor = prodCol.find({});
  let copied = 0;
  let batch: any[] = [];

  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= BATCH_SIZE) {
      await devCol.insertMany(batch, { ordered: false });
      copied += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    await devCol.insertMany(batch, { ordered: false });
    copied += batch.length;
  }

  return copied;
}

async function deltaSyncCollection(
  prodCol: any,
  devCol: any,
  since: Date,
): Promise<{ upserted: number; field: string | null; skipped: boolean; fullFallback?: boolean }> {
  const timestampField = await detectTimestampField(prodCol);
  if (!timestampField) {
    return { upserted: 0, field: null, skipped: true };
  }

  const cursor = prodCol.find({ [timestampField]: { $gte: since } });
  let upserted = 0;
  let ops: any[] = [];
  const allDocs: any[] = [];

  for await (const doc of cursor) {
    allDocs.push(doc);
    ops.push({
      replaceOne: {
        filter: { _id: doc._id },
        replacement: doc,
        upsert: true,
      },
    });
    if (ops.length >= BATCH_SIZE) {
      try {
        await devCol.bulkWrite(ops, { ordered: false });
      } catch (err: any) {
        if (err?.code === 11000 || err?.name === 'MongoBulkWriteError') {
          // Unique-index conflict: prod re-created docs with new _ids.
          // Fall back to full copy of this collection.
          const copied = await fullCopyCollection(prodCol, devCol);
          return { upserted: copied, field: timestampField, skipped: false, fullFallback: true };
        }
        throw err;
      }
      upserted += ops.length;
      ops = [];
    }
  }

  if (ops.length > 0) {
    try {
      await devCol.bulkWrite(ops, { ordered: false });
    } catch (err: any) {
      if (err?.code === 11000 || err?.name === 'MongoBulkWriteError') {
        const copied = await fullCopyCollection(prodCol, devCol);
        return { upserted: copied, field: timestampField, skipped: false, fullFallback: true };
      }
      throw err;
    }
    upserted += ops.length;
  }

  return { upserted, field: timestampField, skipped: false };
}

export async function POST(request: NextRequest) {
  const { isAdmin } = await getAdminAuthState();
  if (!isAdmin) {
    return new Response('Forbidden', { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const mode: SyncMode = body?.mode === 'full' ? 'full' : 'delta';
  const sinceHoursRaw = Number(body?.sinceHours);
  const sinceHours = Number.isFinite(sinceHoursRaw) && sinceHoursRaw > 0 ? sinceHoursRaw : DEFAULT_DELTA_HOURS;
  const onlyCollections = new Set(parseCollectionList(body?.collections));

  // ── Safety gate ──────────────────────────────────────────────────────────
  // Only allow this on dev/preview environments.  If MONGODB_URI doesn't
  // contain 'abl_dev' we refuse to run — this means we would be writing to
  // a non-dev database.
  const mongoUri = process.env.MONGODB_URI ?? '';
  if (!mongoUri.includes(DEV_DB)) {
    const body = JSON.stringify({
      msg: `❌ Safety check failed: MONGODB_URI does not target '${DEV_DB}'. ` +
           `This tool must only run in dev/preview environments.`,
      type: 'error',
    });
    return new Response(`data: ${body}\n\ndata: ${JSON.stringify({ msg: '', type: 'done' })}\n\n`, {
      headers: sseHeaders(),
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg: string, type: 'log' | 'error' | 'done' = 'log') => {
        const line = `data: ${JSON.stringify({ msg, type })}\n\n`;
        controller.enqueue(encoder.encode(line));
      };

      let client: MongoClient | null = null;
      try {
        // Build prod URI by swapping the db path segment
        const prodUri = mongoUri.replace(`/${DEV_DB}`, `/${PROD_DB}`);

        send(`🔗 Connecting to MongoDB…`);
        client = new MongoClient(prodUri, {
          serverSelectionTimeoutMS: 15000,
          connectTimeoutMS: 15000,
          family: 4,
        });
        await client.connect();

        const prodDb = client.db(PROD_DB);
        const devDb  = client.db(DEV_DB);

        // List all collections, skip views
        const allInfos = await prodDb.listCollections().toArray();
        const collections = allInfos
          .filter((c: any) => c.type !== 'view')
          .filter((c: any) => onlyCollections.size === 0 || onlyCollections.has(c.name));
        const skippedViews = allInfos.length - collections.length;
        const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

        send(
          `📦 Found ${collections.length} collections to sync (${skippedViews} views skipped)`
        );
        send(`⚙️ Mode: ${mode === 'full' ? 'full copy (drop + repopulate)' : `delta upsert (last ${sinceHours}h)`}\n`);

        let totalDocs = 0;
        let skippedNoTimestamp = 0;
        for (const info of collections) {
          const name = info.name as string;
          const prodCol = prodDb.collection(name);
          const devCol  = devDb.collection(name);

          if (mode === 'full') {
            const copied = await fullCopyCollection(prodCol, devCol);
            send(`  ✓ ${name} — ${copied} docs copied`);
            totalDocs += copied;
          } else {
            const result = await deltaSyncCollection(prodCol, devCol, since);
            if (result.skipped) {
              skippedNoTimestamp += 1;
              send(`  ↷ ${name} — skipped (no timestamp field found)`);
            } else if (result.fullFallback) {
              send(`  ✓ ${name} — ${result.upserted} docs (full copy; duplicate-key conflict in delta mode)`);
              totalDocs += result.upserted;
            } else {
              send(`  ✓ ${name} — ${result.upserted} docs upserted via ${result.field}`);
              totalDocs += result.upserted;
            }
          }
        }

        if (mode === 'delta' && skippedNoTimestamp > 0) {
          send(`ℹ️  ${skippedNoTimestamp} collection(s) skipped in delta mode due to missing timestamp fields.`);
        }

        send(`\n✅ Done — ${totalDocs.toLocaleString()} total documents ${mode === 'full' ? 'synced' : 'upserted'} to '${DEV_DB}'`);
        send(`ℹ️  Views were skipped. Run scripts/recreate-dev-views.js if you need to refresh them.`);
        send('', 'done');
      } catch (err) {
        send(
          `❌ Error: ${err instanceof Error ? err.message : String(err)}`,
          'error'
        );
        send('', 'done');
      } finally {
        if (client) await client.close().catch(() => {});
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}

function sseHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}
