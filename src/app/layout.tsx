import type { Metadata } from "next";
import { Fraunces, Source_Serif_4, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { AdvancedModeProvider } from "@/lib/ui/AdvancedModeProvider";

// Fraunces — variable display serif (SOFT + opsz axes) for headlines and
// the gutter numeral. Cyrillic display text falls back to Source Serif.
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"],
  axes: ["SOFT", "opsz"],
  display: "swap",
});

// Source Serif 4 — body workhorse. Full Cyrillic, academic tone.
const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

// IBM Plex Mono — every number, every measurement, every eyebrow.
const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin", "cyrillic"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tournament Variance Simulator",
  description: "Monte Carlo variance simulator for MTT / SNG schedules",
};

const themeInitScript = `
try {
  var t = localStorage.getItem('tvs:theme');
  if (t === 'light' || t === 'dark') {
    document.documentElement.setAttribute('data-theme', t);
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
  }
} catch (e) {
  document.documentElement.setAttribute('data-theme', 'light');
}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${fraunces.variable} ${sourceSerif.variable} ${plexMono.variable} h-full`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full">
        <ThemeProvider>
          <LocaleProvider>
            <AdvancedModeProvider>{children}</AdvancedModeProvider>
          </LocaleProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
