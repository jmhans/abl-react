import './globals.css';
import { inter } from '@/app/ui/fonts';
import Header from '@/app/ui/header';
import Navigation from '@/app/ui/navigation';
import { Suspense } from 'react';

export const metadata = {
  title: 'ABL - Fantasy Baseball',
  description: 'Advanced Baseball League Fantasy Baseball Game',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>
        <Header />
        <Suspense fallback={<div />}>
          <Navigation />
        </Suspense>
        <main className="p-4 md:p-6">{children}</main>
      </body>
    </html>
  );
}
