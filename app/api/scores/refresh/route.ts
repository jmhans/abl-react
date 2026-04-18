import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { runDailyStatRefresh } from '@/app/lib/stat-refresh-service';
import { getSessionUserFromCookies } from '@/app/lib/admin-auth';
import { deriveAblDate } from '@/app/lib/abl-date';

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const COOLDOWN_KEY = 'scores_refresh_cooldown';

// POST /api/scores/refresh — trigger today's stat refresh (any logged-in user, 5-min cooldown)
export async function POST(_request: NextRequest) {
  const user = await getSessionUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in to refresh scores' }, { status: 401 });
  }

  const db = await connectToDatabase();
  const settings = db.collection('app_settings');

  // Check cooldown
  const cooldownDoc = await settings.findOne({ key: COOLDOWN_KEY });
  const now = new Date();

  if (cooldownDoc?.lastRefreshedAt) {
    const elapsed = now.getTime() - new Date(cooldownDoc.lastRefreshedAt).getTime();
    if (elapsed < COOLDOWN_MS) {
      const secondsRemaining = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
      return NextResponse.json(
        { error: 'Refresh on cooldown', secondsRemaining },
        { status: 429 }
      );
    }
  }

  // Claim the cooldown slot before doing the work (prevents double-triggers)
  await settings.updateOne(
    { key: COOLDOWN_KEY },
    { $set: { key: COOLDOWN_KEY, lastRefreshedAt: now } },
    { upsert: true }
  );

  try {
    // Use the ABL date boundary (08:00Z cutoff) instead of raw UTC midnight.
    // MLB games regularly finish after midnight UTC (e.g. 11 PM ET = 3 AM UTC),
    // so using today's UTC date would miss games that belong to the current ABL day.
    const ablDateStr = deriveAblDate(now);
    const [year, month, day] = ablDateStr.split('-').map(Number);
    const gameDate = new Date(Date.UTC(year, month - 1, day));
    const result = await runDailyStatRefresh(db, gameDate, { recalculate: true });

    return NextResponse.json({
      ok: true,
      refreshedAt: now.toISOString(),
      ablDate: ablDateStr,
      mlbGamesActive: result.refreshSummary?.anyMlbGamesStarted ?? false,
      mlbGamesComplete: result.refreshSummary?.allMlbGamesComplete ?? false,
      playersUpdated: result.refreshSummary?.playersUpdated ?? 0,
      gamesRecalculated: result.recalcSummary?.processed ?? 0,
      gamesSkipped: result.recalcSummary?.skipped ?? 0,
    });
  } catch (err) {
    // On error, clear the cooldown so they can try again
    await settings.updateOne({ key: COOLDOWN_KEY }, { $unset: { lastRefreshedAt: '' } });
    console.error('Scores refresh error:', err);
    return NextResponse.json({ error: 'Refresh failed' }, { status: 500 });
  }
}

// GET /api/scores/refresh — check cooldown state (any logged-in user)
export async function GET(_request: NextRequest) {
  const user = await getSessionUserFromCookies();
  if (!user) {
    return NextResponse.json({ loggedIn: false });
  }

  const db = await connectToDatabase();
  const cooldownDoc = await db.collection('app_settings').findOne({ key: COOLDOWN_KEY });
  const now = Date.now();

  if (cooldownDoc?.lastRefreshedAt) {
    const elapsed = now - new Date(cooldownDoc.lastRefreshedAt).getTime();
    if (elapsed < COOLDOWN_MS) {
      return NextResponse.json({
        loggedIn: true,
        onCooldown: true,
        secondsRemaining: Math.ceil((COOLDOWN_MS - elapsed) / 1000),
        lastRefreshedAt: cooldownDoc.lastRefreshedAt,
      });
    }
  }

  return NextResponse.json({
    loggedIn: true,
    onCooldown: false,
    lastRefreshedAt: cooldownDoc?.lastRefreshedAt ?? null,
  });
}
