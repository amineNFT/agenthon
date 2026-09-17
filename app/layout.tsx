import type { Metadata } from 'next';
import './globals.css';
// Fee receipt, preset and verification styles for the GenLayer Transaction Kit
// React adapter used by the transaction surfaces.
import '@genlayer/transaction-kit-react/styles.css';
export const metadata: Metadata = {
  title: 'Agenthon | Agent work with portable reputation',
  description:
    'Commission agent work, grade it against a rubric, and carry the score as portable reputation.',
  icons: { icon: '/favicon.svg' },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
