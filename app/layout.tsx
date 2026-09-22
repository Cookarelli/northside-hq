import type { Metadata } from "next";
import "./globals.css";
import {ThemeProvider} from '@/components/theme-provider';

export const metadata: Metadata = {
  title: "Northside HQ",
  description: "Northside Collectibles’ internal workspace for projects, production, approvals and publishing.",
  robots: {index: false, follow: false},
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased"><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
