'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function FreeAgentsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    // For now, just redirect to home
    // User can navigate to their team's free agents from there
    router.push('/');
  }, [router]);

  return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
}
