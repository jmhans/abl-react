import './globals.css';
import { inter } from '@/app/ui/fonts';
import Header from '@/app/ui/header';
import Navigation from '@/app/ui/navigation';

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
        <div className="flex">
          <Navigation />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
