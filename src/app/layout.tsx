import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { AdvancedModeProvider } from "@/lib/ui/AdvancedModeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
  preload: false,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
  preload: false,
});

// Fraunces — display serif for section numerals + KPI hero numbers.
// Latin only (cyrillic isn't available in this family); we only use it for
// digits + section titles, both of which are language-agnostic.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["700", "900"],
  preload: false,
});

export const metadata: Metadata = {
  title: "Tournament Variance Simulator",
  description: "Monte Carlo variance simulator for MTT / SNG schedules",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full`}
    >
      <body className="min-h-full">
        <ThemeProvider>
          <LocaleProvider>
            <AdvancedModeProvider>{children}</AdvancedModeProvider>
          </LocaleProvider>
        </ThemeProvider>
        {process.env.VERCEL ? <Analytics /> : null}
      </body>
    </html>
  );
}
