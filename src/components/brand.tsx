import Link from "next/link";
import { Ecg, Mixed, Scallop } from "@/components/ui";
import {
  StickerBandage,
  StickerCross,
  StickerHeartbeat,
  StickerPill,
  StickerThermometer,
} from "@/components/stickers";

/**
 * The mark, on its brand tile.
 *
 * The heart is the same path public/icon.svg draws, so the logo in the sidebar
 * and the icon in the browser tab are the same shape. Both come from
 * scripts/generate-icons.mjs — change the curve there and copy it here, or the
 * two drift apart. The tile stays a flat brand fill rather than the icon's
 * gradient: the gradient's dark end has no contrast-checked token in dark mode,
 * and a white heart on light pink is not readable.
 */
export const MARK_PATH =
  "M32 48C20.5 39.5 12 32.5 12 25.5C12 19.5 16.8 15.5 22.4 15.5" +
  "C26.6 15.5 30.2 18 32 21.4C33.8 18 37.4 15.5 41.6 15.5" +
  "C47.2 15.5 52 19.5 52 25.5C52 32.5 43.5 39.5 32 48Z";

export function Logo({ size = 40, tone = "brand" }: { size?: number; tone?: "brand" | "invert" }) {
  // On a solid pink panel the tile has to flip, or it disappears into its own
  // background. Two tones rather than an opacity trick, so both stay flat.
  const skin =
    tone === "invert" ? "bg-on-brand text-brand-deep" : "bg-brand-solid text-on-brand";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-[14px] ${skin}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" fill="currentColor" style={{ width: size * 0.62 }}>
        <path d={MARK_PATH} />
      </svg>
    </span>
  );
}

/**
 * The HACK logo, linking home. Two files: black ink for light mode and white
 * for dark, swapped by the theme in globals.css (.hs-logo-light / -dark).
 */
export function Wordmark() {
  return (
    <Link href="/dashboard" aria-label="KMIDS Hack, home" className="inline-flex items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/hack-logo-black.png" alt="KMIDS Hack" width={477} height={200} className="hs-logo-light h-9 w-auto" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/hack-logo-white.png" alt="" aria-hidden="true" width={477} height={200} className="hs-logo-dark h-9 w-auto" />
    </Link>
  );
}

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col">
      {/* The pink panel. Deep pink rather than the primary: this is a ground
          carrying white type, and #ec4899 under white is 3.5:1 — a colour that
          cannot hold text is not a colour you can build a panel out of. */}
      <div className="hs-band hs-band-pink relative overflow-hidden px-4 pb-14 pt-16 sm:pb-20 sm:pt-24">
        {/* Scattered at the join, and gone below 640px, where they would land
            on the words rather than around them. */}
        <StickerCross tilt={-14} className="hs-sticker-scatter left-[7%] top-[14%] h-20 lg:h-28" />
        <StickerHeartbeat
          tilt={11}
          className="hs-sticker-scatter right-[8%] top-[12%] h-24 lg:h-32"
        />
        <StickerPill tilt={-8} className="hs-sticker-scatter bottom-[10%] left-[19%] h-16 lg:h-24" />
        <StickerBandage
          tilt={16}
          className="hs-sticker-scatter bottom-[14%] right-[20%] h-16 lg:h-24"
        />
        <StickerThermometer
          tilt={-6}
          className="hs-sticker-scatter left-[26%] top-[8%] hidden h-20 xl:block"
        />

        <div className="relative z-[2] mx-auto flex w-full max-w-[620px] flex-col items-center gap-3 text-center">
          <Logo size={56} tone="invert" />
          {subtitle ? (
            <p className="hs-rise hs-rise-1 hs-eyebrow text-on-brand">{subtitle}</p>
          ) : null}
          <h1 className="hs-rise hs-rise-2 hs-display">
            <Mixed>{title}</Mixed>
          </h1>
          {/* The heartbeat as the headline's underline, drawn once on arrival.
              This is the one orchestrated moment in the whole portal. */}
          <Ecg underline className="hs-rise hs-rise-3 -mt-0.5 h-9 w-56 text-on-brand/90 sm:w-72" />
        </div>
      </div>

      <Scallop from="pink" to="b" />

      <div className="hs-band hs-band-b flex grow flex-col justify-center px-4 pb-14 pt-10">
        <div className="mx-auto w-full max-w-[440px]">
          <div className="hs-card border-brand/45 p-6">{children}</div>
          {footer ? (
            <div className="mx-auto mt-6 max-w-[38ch] text-center text-sm text-muted [text-wrap:pretty]">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
