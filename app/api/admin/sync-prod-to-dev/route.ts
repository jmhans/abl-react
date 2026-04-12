import { NextRequest } from 'next/server';
import { MongoClient } from 'mongodb';
import { getAdminAuthState } from '@/app/lib/admin-auth';

const PROD_DB = 'heroku_wm40bx9r';
const DEV_DB  = 'abl_dev';

export const dynamic = 'force-dynamic';
// Long-running sync — give it up to 5 minutes before Vercel kills it
export const maxDuration = 300;

export async function POST(_request: NextRequest) {
  const { isAdmin } = await getAdminAuthState();
  if (!isAdmin) {
    return new Response('Forbidden', { status: 403 });
  }

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
        const collections = allInfos.filter((c: any) => c.type !== 'view');
        const skippedViews = allInfos.length - collections.length;

        send(
          `📦 Found ${collections.length} collections to sync (${skippedViews} views skipped)\n`
        );

        let totalDocs = 0;
        for (const info of collections) {
          const name = info.name as string;
          const prodCol = prodDb.collection(name);
          const devCol  = devDb.collection(name);

          // Drop dev collection first (ignore "ns not found" = code 26)
          try {
            await devDb.dropCollection(name);
          } catch (e: any) {
            if (e?.code !== 26) throw e;
          }

          const docs = await prodCol.find({}).toArray();
          if (docs.length > 0) await devCol.insertMany(docs);

          send(`  ✓ ${name} — ${docs.length} docs`);
          totalDocs += docs.length;
        }

        send(`\n✅ Done — ${totalDocs.toLocaleString()} total documents synced to '${DEV_DB}'`);
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
