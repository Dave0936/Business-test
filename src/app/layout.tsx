import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "WebOpportunity AI", template: "%s · WebOpportunity AI" },
  description: "Find businesses that need a better website, build a concept, and win the work.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
