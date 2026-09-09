import type { Metadata } from "next";
import { Manrope, IBM_Plex_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// Manrope: UI/heading face - a geometric grotesk with more character than
// the generic "safe" choice, legible at small dashboard sizes. IBM Plex
// Mono: reserved for data that should line up in columns (page counters,
// meter readings, serials, IPs, money) - see tabular-nums usage - a
// deliberate nod to this being an operational/data tool, not a marketing
// site, rather than reaching for the same sans everywhere.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "OmniPrint",
  description: "Monitoramento de parque de impressoras",
};

// Root layout: html/body/fonts only, shared by both route groups -
// (tenant) (the outsourcing company's own dashboard) and platform (the
// OmniPrint operator's own area). Each of those adds its own header/nav in
// its own nested layout - see app/(tenant)/layout.tsx and
// app/platform/layout.tsx.
// Applies a stored light/dark choice (see ThemeToggle) to <html> before
// hydration/first paint - without this, the page would render in the OS
// default for a frame and then visibly snap to the stored choice.
// beforeInteractive is the one strategy that runs early enough for that;
// afterInteractive (next/script's default) would still flash.
const THEME_INIT_SCRIPT = `
try {
  var t = localStorage.getItem('omniprint-theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
`;

// Every date/time on this app renders server-side (Railway, UTC) - without
// knowing the viewer's actual timezone there's no way to show it correctly
// there. A cookie is the only way a Server Component can know it (there's
// no HTTP header for it) - this sets one to the browser's own resolved IANA
// zone so it's already correct on every SUBSEQUENT request (see
// getViewerTimeZone). Doesn't need beforeInteractive like the theme script
// above - this doesn't change anything on the page currently being viewed,
// only what the *next* request renders, so there's no flash to prevent.
// Only writes when the value actually changed (a fresh cookie write on every
// single page load would be wasteful and pointless).
const TIMEZONE_SYNC_SCRIPT = `
try {
  var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  var existing = document.cookie.replace(/(?:(?:^|.*;\\s*)omniprint_tz\\s*=\\s*([^;]*).*$)|^.*$/, '$1');
  if (tz && tz !== existing) {
    document.cookie = 'omniprint_tz=' + tz + '; path=/; max-age=31536000; SameSite=Lax';
  }
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${manrope.variable} ${plexMono.variable} h-full antialiased`}
      // The theme-init script below sets data-theme on this element before
      // React hydrates (that's the whole point - avoids a flash of the
      // wrong theme). React can't know that was intentional, so it flags a
      // hydration mismatch on this one attribute - this is the documented,
      // correct way to tell it "expected, ignore" for exactly this
      // pattern, not a workaround for a real bug.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <Script id="tz-sync" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: TIMEZONE_SYNC_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
