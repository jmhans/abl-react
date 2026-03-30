import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { connectToDatabase } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

const FALLBACK = '/abl/2025';

/**
 * Root: redirect to the user's active league/season if they have one,
 * otherwise fall back to the default ABL 2025 season.
 */
export default async function RootPage() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('appSession');

    if (sessionCookie?.value) {
      const userId: string | undefined = JSON.parse(sessionCookie.value).user?.sub;

      if (userId) {
        const db = await connectToDatabase();
        const myTeam = await db
          .collection('ablteams')
          .findOne({ 'owners.userId': userId });

        if (myTeam) {
          const season = await db.collection('seasons').findOne({
            teamIds: myTeam._id,
            isActive: true,
          });

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
  } catch {
    // DB/cookie errors — fall through to fallback
  }

  redirect(FALLBACK);
}

