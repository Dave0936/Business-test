import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "WebOpportunity AI", template: "%s · WebOpportunity AI" },
  description: "Find businesses that need a better website, build a concept, and win the work.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = (await cookies()).get("wo_theme")?.value;
  const cls = theme === "dark" ? "dark" : theme === "light" ? "light" : "";
  return (
    <html lang="en-GB" className={`h-full ${cls}`} suppressHydrationWarning>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
