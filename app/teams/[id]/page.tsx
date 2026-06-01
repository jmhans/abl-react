import { redirect } from 'next/navigation';
import { resolveLegacyLeagueSeason } from '@/app/teams/legacy-redirect';

export default async function LegacyTeamDetailRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ league?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { leagueSlug, seasonYear } = await resolveLegacyLeagueSeason(sp?.league ?? null);
  redirect(`/${leagueSlug}/${seasonYear}/teams/${id}?tab=roster`);
}
