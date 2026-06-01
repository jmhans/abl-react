import { redirect } from 'next/navigation';
import { resolveLegacyLeagueSeason } from '@/app/teams/legacy-redirect';

export default async function LegacyTeamsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string }>;
}) {
  const sp = await searchParams;
  const { leagueSlug, seasonYear } = await resolveLegacyLeagueSeason(sp?.league ?? null);
  redirect(`/${leagueSlug}/${seasonYear}/teams`);
}
