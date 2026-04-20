import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { AdvancedModeProvider } from "@/lib/ui/AdvancedModeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
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
