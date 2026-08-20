import { Copy, Heart, Activity } from 'lucide-react';
import { EcgLine } from '@/components/ecg';
import { CopyChip } from './copy-chip';

/**
 * The 2027 brand kit (§5.9): palette with hex codes, typography, logo files
 * and the ECG motif assets.
 */
const PALETTE = [
  { name: 'Primary pink', hex: '#EC4899', use: 'Buttons, active nav, the ECG line' },
  { name: 'Deep accent', hex: '#BE185D', use: 'Headings on wash, hover states' },
  { name: 'Background wash', hex: '#FDF2F8', use: 'Page background, soft panels' },
  { name: 'Base surface', hex: '#FFFFFF', use: 'Cards, sheets, the editor' },
  { name: 'Body text', hex: '#1F2937', use: 'All body copy' },
  { name: 'Secondary', hex: '#94A3B8', use: 'Muted text, thin dividers' },
  { name: 'Health accent', hex: '#2DD4BF', use: 'Success and live states only — sparingly' },
];

const TYPE_SCALE = [
  { label: 'Display', size: '58px', weight: 800, note: 'Countdown only' },
  { label: 'Heading 1', size: '24px', weight: 800, note: 'Screen titles' },
  { label: 'Heading 2', size: '17px', weight: 700, note: 'Card headings' },
  { label: 'Body', size: '14px', weight: 400, note: 'Everything else' },
  { label: 'Caption', size: '12px', weight: 600, note: 'Meta, labels' },
  { label: 'Mono tag', size: '10px', weight: 700, note: 'Dates, codes, statuses' },
];

export function BrandKit() {
  return (
    <div className="flex flex-col gap-5">
      <section className="card overflow-hidden">
        <div className="relative overflow-hidden p-7"
          style={{ background: 'linear-gradient(120deg, var(--surface) 0%, var(--wash) 100%)' }}>
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-[14px] bg-pink text-white">
              <Heart size={26} strokeWidth={1.75} />
            </div>
            <div>
              <div className="text-[22px] font-extrabold tracking-[-0.02em]">
                KMIDS Hackathon 2027
              </div>
              <div className="mono-tag text-deep">MEDTECH &amp; DIGITAL HEALTH</div>
            </div>
          </div>
          <div className="mt-5">
            <EcgLine width={900} height={54} animate />
          </div>
          <p className="mt-2 max-w-[560px] text-[13px] text-muted-2">
            Clean, clinical, bright. White and blush dominate; pink is an accent, never a
            full dark fill. One or two ECG lines per screen, maximum.
          </p>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-4 text-[14px] font-bold">Palette</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PALETTE.map((c) => (
            <div key={c.hex} className="overflow-hidden rounded-xl border border-line">
              <div className="h-[74px] border-b border-line" style={{ background: c.hex }} />
              <div className="p-3">
                <div className="text-[13px] font-semibold">{c.name}</div>
                <CopyChip value={c.hex} />
                <p className="mt-1.5 text-[11.5px] leading-snug text-muted-2">{c.use}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 text-[14px] font-bold">Typography</h2>
        <p className="mb-4 text-[12.5px] text-muted-2">
          Inter throughout — headings heavier, body regular.
        </p>
        <div className="flex flex-col divide-y divide-line">
          {TYPE_SCALE.map((t) => (
            <div key={t.label} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
              <span className="w-[92px] shrink-0 text-[12px] font-semibold text-muted-2">
                {t.label}
              </span>
              <span
                className="min-w-0 flex-1 truncate"
                style={{ fontSize: t.size, fontWeight: t.weight, letterSpacing: '-0.02em' }}
              >
                Aa Bb Cc 2027
              </span>
              <span className="mono-tag shrink-0 text-muted">
                {t.size} / {t.weight}
              </span>
              <span className="w-full text-[11.5px] text-muted-2 sm:w-auto">{t.note}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 text-[14px] font-bold">ECG motif</h2>
        <p className="mb-4 text-[12.5px] text-muted-2">
          The signature element. Section dividers, the loading animation, the progress bar.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <MotifCard label="Divider (static)">
            <EcgLine width={400} height={40} />
          </MotifCard>
          <MotifCard label="Loading (animated)">
            <EcgLine width={400} height={40} animate />
          </MotifCard>
          <MotifCard label="Deep variant">
            <EcgLine width={400} height={40} color="var(--deep)" />
          </MotifCard>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-4 flex items-center gap-2 text-[14px] font-bold">
          <Activity size={16} className="text-pink" /> Usage rules
        </h2>
        <ul className="flex flex-col gap-2 text-[13px] text-muted-2">
          <Rule ok>Border radius 8–16px, generous whitespace, thin light dividers.</Rule>
          <Rule ok>Buttons: pink fill for primary, pink outline for secondary, plain text for tertiary.</Rule>
          <Rule ok>Medical glyphs from lucide — plus, heart, activity, shield, stethoscope, pill.</Rule>
          <Rule>No dark navy anywhere. No dark sidebar.</Rule>
          <Rule>No dark gradients, no neon, no heavy shadows.</Rule>
          <Rule>Teal is for success and live states only, never decoration.</Rule>
        </ul>
      </section>
    </div>
  );
}

function MotifCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4">
      <div className="mono-tag mb-2 text-muted-2">{label}</div>
      {children}
    </div>
  );
}

function Rule({ children, ok = false }: { children: React.ReactNode; ok?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ background: ok ? 'var(--teal)' : 'var(--danger)' }}
      />
      <span>{children}</span>
    </li>
  );
}
