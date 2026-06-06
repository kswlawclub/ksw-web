import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KSW L.C.",
  description: "KSW L.C. club homepage, league table, fixtures, and sponsors.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
