/** Initials avatar. Colour is derived from the name so it stays stable. */
const PALETTE = ['#EC4899', '#DB2777', '#BE185D', '#C05B86', '#8E6C86', '#7C6E86', '#0EA5E9'];

export function initialsOf(name: string | null, fallback = '??'): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : parts[0]?.[1] ?? '';
  return (first + second).toUpperCase();
}

export function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length] ?? '#EC4899';
}

export function Avatar({
  name,
  size = 34,
  color,
  className = '',
}: {
  name: string | null;
  size?: number;
  color?: string;
  className?: string;
}) {
  const initials = initialsOf(name);
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-bold text-white ${className}`}
      style={{
        width: size,
        height: size,
        background: color ?? colorFor(name ?? 'anon'),
        fontSize: Math.max(10, Math.round(size * 0.38)),
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
