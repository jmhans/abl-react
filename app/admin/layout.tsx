// Mark all admin routes as dynamic since they require auth checks
export const dynamic = 'force-dynamic';

import Link from 'next/link';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // Removed client-side auth check - routes are protected via middleware
  // This layout is now a server component, allowing dynamic = 'force-dynamic' to work
  
  return <>{children}</>;
}
