/**
 * The ECG/heartbeat line — the signature motif from §7.
 * Used as a section divider, the loading animation and the progress bar.
 * One or two per screen, maximum.
 */
export function EcgLine({
  width = 600,
  height = 46,
  color = 'var(--pink)',
  animate = false,
  className,
  strokeWidth = 2.5,
}: {
  width?: number;
  height?: number;
  color?: string;
  animate?: boolean;
  className?: string;
  strokeWidth?: number;
}) {
  const h = height;
  const w = width;
  // Two heartbeats across the width, flat-lining at each end.
  const points = [
    [0, h / 2],
    [w * 0.12, h / 2],
    [w * 0.17, h * 0.3],
    [w * 0.22, h * 0.8],
    [w * 0.27, h * 0.1],
    [w * 0.32, h * 0.9],
    [w * 0.37, h / 2],
    [w * 0.55, h / 2],
    [w * 0.6, h * 0.35],
    [w * 0.64, h * 0.75],
    [w * 0.69, h * 0.15],
    [w * 0.74, h * 0.85],
    [w * 0.79, h / 2],
    [w, h / 2],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(' ');

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={animate ? { strokeDasharray: 1000, animation: 'ecgdash 6s linear infinite' } : undefined}
      />
    </svg>
  );
}

/** The app's loading state. */
export function EcgLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-16"
      role="status"
      aria-live="polite"
    >
      <div className="w-[220px]">
        <EcgLine width={220} height={60} animate />
      </div>
      <div className="mono-tag text-muted-2">{label}…</div>
    </div>
  );
}

/** A thin ECG divider between sections. */
export function EcgDivider({ className = '' }: { className?: string }) {
  return (
    <div className={`opacity-60 ${className}`}>
      <EcgLine width={600} height={24} strokeWidth={1.75} />
    </div>
  );
}
