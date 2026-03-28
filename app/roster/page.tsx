'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function MyRosterRedirect() {
  const router = useRouter();

  useEffect(() => {
    // For now, just redirect to dashboard
    // User can navigate to their team's roster from there
    router.push('/');
  }, [router]);

  return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
}
