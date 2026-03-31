import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { connectToDatabase } from '@/app/lib/mongodb';

/**
 * Root: redirect to the user's active league/season if they have one,
 * otherwise fall back to the current active ABL season.
 */
export default async function RootPage() {
  try {
    const db = await connectToDatabase();
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('appSession');

    if (sessionCookie?.value) {
      const userId: string | undefined = JSON.parse(sessionCookie.value).user?.sub;

      if (userId) {
        const myTeam = await db
          .collection('ablteams')
          .findOne({ 'owners.userId': userId });

        if (myTeam) {
          // Prefer the newest active season this user's team belongs to
          const season = await db.collection('seasons').findOne(
            { teamIds: myTeam._id, isActive: true },
            { sort: { year: -1 } }
          );

          if (season) {
            const league = await db
              .collection('leagues')
              .findOne({ _id: season.leagueId });

            if (league?.slug) {
              redirect(`/${league.slug}/${season.year}`);
            }
          }
        }
      }
    }

    // Fallback: find the active ABL season dynamically (never hardcode a year)
    const ablLeague = await db.collection('leagues').findOne({ slug: 'abl' });
    if (ablLeague) {
      const activeSeason = await db.collection('seasons').findOne(
        { leagueId: ablLeague._id, isActive: true },
        { sort: { year: -1 } }
      );
      if (activeSeason) {
        redirect(`/abl/${activeSeason.year}`);
      }
    }
  } catch {
    // DB/cookie errors — last-resort static fallback
  }

  redirect('/abl/2026');
}

