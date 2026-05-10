import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Goedkope Benzine Duitsland',
  description:
    'Vind goedkope Duitse tankstations vanaf je vertrekpunt en vergelijk ritkosten, literprijzen en totale besparing.',
  keywords: ['goedkope benzine', 'duitse tankstations', 'tankplanner duitsland', 'benzineprijs', 'tankkosten'],
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
