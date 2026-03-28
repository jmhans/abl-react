import { redirect } from 'next/navigation';

/**
 * Root: redirect to the active ABL season.
 * Update this when a new season becomes active.
 */
export default function RootPage() {
  redirect('/abl/2025');
}
