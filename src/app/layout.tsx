import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SlimTanken',
  description:
    'SlimTanken helpt je goedkope Duitse tankstations te vinden en ritkosten, literprijzen en totale besparing te vergelijken.',
  keywords: ['slimtanken', 'goedkope benzine', 'duitse tankstations', 'tankplanner duitsland', 'tankkosten'],
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
