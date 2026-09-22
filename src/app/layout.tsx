import React from 'react';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GETboard — link-only navigation channel',
  description:
    'A web-reading agent transmits text purely by choosing which links to follow.',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="robots" content="noindex,nofollow" />
      </head>
      <body>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
