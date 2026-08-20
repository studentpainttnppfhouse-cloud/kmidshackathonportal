import { EcgLine } from '@/components/ecg';

export function CountdownHero({
  days,
  pct,
  caption,
}: {
  days: number;
  pct: number;
  caption: string;
}) {
  return (
    <section
      className="relative overflow-hidden rounded-[18px] border border-line p-6 shadow-raised md:px-7"
      style={{ background: 'linear-gradient(120deg, var(--surface) 0%, var(--wash) 100%)' }}
    >
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="mono-tag text-deep">COUNTDOWN TO EVENT</div>
          <div className="mt-1.5 flex items-baseline gap-3">
            <span className="text-[48px] font-extrabold leading-none tracking-[-0.03em] text-deep md:text-[58px]">
              {days}
            </span>
            <span className="text-[18px] font-bold md:text-xl">
              {days === 1 ? 'day to go' : 'days to go'}
            </span>
          </div>
          <div className="mono-tag mt-2 text-muted-2">
            20–21 MARCH 2027 · KMIDS 7F · BANGKOK
          </div>
        </div>

        <div className="min-w-[220px] max-w-[420px] flex-1">
          <div className="mb-1.5 flex justify-between text-[12px] font-semibold text-muted-2">
            <span>Planning progress</span>
            <span className="text-deep">{pct}%</span>
          </div>
          <div className="h-[9px] overflow-hidden rounded-[6px] bg-surface-3">
            <div
              className="h-full rounded-[6px]"
              style={{
                width: `${pct}%`,
                background: 'linear-gradient(90deg, var(--pink), var(--deep))',
              }}
            />
          </div>
          <div className="mt-2.5 opacity-70">
            <EcgLine width={600} height={30} strokeWidth={2} />
          </div>
          <p className="mt-1 text-[12.5px] text-muted-2">{caption}</p>
        </div>
      </div>
    </section>
  );
}
