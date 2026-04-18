import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RoutRider – Motorroutes plannen',
  description:
    'Plan motorroutes op de kaart. Geen snelwegen, toeristisch of snel reizen. Exporteer als GPX voor TomTom, Garmin en je telefoon.',
  keywords: ['motorroute', 'routeplanner', 'GPX', 'motorrijder', 'tourroute'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
