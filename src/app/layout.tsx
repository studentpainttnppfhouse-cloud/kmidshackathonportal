import type { Metadata, Viewport } from 'next';
import { envProblems } from '@/lib/env';
import { SetupRequired } from '@/components/setup-required';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hackathon Studio · KMIDS 2027',
  description:
    'Internal staff portal for KMIDS Hackathon 2027 — MedTech & Digital Health, 20–21 March 2027.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#EC4899',
};

/**
 * A deployment with no Supabase credentials cannot render a single app route:
 * every one of them resolves the session first, and that needs the service-role
 * key. Left alone it surfaces as Next's opaque "a server-side exception has
 * occurred" digest, which tells whoever just deployed nothing at all. So the
 * check happens here, once, above every route, and names what is missing.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const problems = envProblems();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        {/*
          Apply the saved theme before first paint so a returning user never
          sees a flash of the wrong palette.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('hs-theme');if(t==='dark'){document.documentElement.setAttribute('data-theme','dark')}}catch(e){}})();`,
          }}
        />
      </head>
      <body>{problems.length > 0 ? <SetupRequired problems={problems} /> : children}</body>
    </html>
  );
}
