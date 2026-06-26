'use client';

import Link from 'next/link';

type LogoVariant = 'default' | 'reversed' | 'dark' | 'mono';

// Static clip-path ids. The clip geometry is constant across every instance
// (objectBoundingBox units, variant/size-independent), so a shared id is safe
// AND deterministic — unlike useId(), it renders identically on server and
// client, so it can never contribute to a hydration mismatch.
const TOP_CLIP = 'thmark-clip-top';
const BOT_CLIP = 'thmark-clip-bot';

interface TripyLogoProps {
  className?: string;
  /** Pixel size of the square mark. Defaults to 40. */
  size?: number;
  /** @deprecated kept for backwards-compat; use `size` instead. */
  iconClassName?: string;
  showText?: boolean;
  href?: string;
  variant?: LogoVariant;
}

const VARIANTS: Record<
  LogoVariant,
  { box: string; stroke: string; star: string; trips: string; hacker: string }
> = {
  // The mark: a prompt `>` chevron split by a clean line — the lower half drops
  // to a lighter tone (the paper-plane shadow), with a `_` cursor and an amber
  // loyalty-points star.
  default: { box: '#2563eb', stroke: '#ffffff', star: '#fbbf24', trips: '#2563eb', hacker: '#0f172a' },
  reversed: { box: '#ffffff', stroke: '#2563eb', star: '#f59e0b', trips: '#ffffff', hacker: '#ffffff' },
  dark: { box: '#1e293b', stroke: '#ffffff', star: '#fbbf24', trips: '#60a5fa', hacker: '#ffffff' },
  mono: { box: '#0f172a', stroke: '#ffffff', star: '#ffffff', trips: '#0f172a', hacker: '#0f172a' },
};

/** The TripsHacker square mark — renders the `>_` prompt + paper-plane shadow + points star. */
export function TripsHackerMark({
  size = 40,
  variant = 'default',
  className = '',
}: {
  size?: number;
  variant?: LogoVariant;
  className?: string;
}) {
  const topClip = TOP_CLIP;
  const botClip = BOT_CLIP;
  const { box, stroke, star } = VARIANTS[variant];
  // Hide the cursor underscore below ~24px, mirroring the favicon treatment.
  const showCursor = size >= 24;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      className={className}
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={topClip} clipPathUnits="objectBoundingBox">
          <rect x="-0.2" y="-0.2" width="1.4" height="0.7" />
        </clipPath>
        <clipPath id={botClip} clipPathUnits="objectBoundingBox">
          <rect x="-0.2" y="0.5" width="1.4" height="0.7" />
        </clipPath>
      </defs>
      <rect width="96" height="96" rx="24" fill={box} />
      {/* chevron — top half at full opacity */}
      <path
        d="M30 34 L52 48 L30 62"
        stroke={stroke}
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        clipPath={`url(#${topClip})`}
      />
      {/* chevron — lower half, the paper-plane shadow */}
      <path
        d="M30 34 L52 48 L30 62"
        stroke={stroke}
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity={0.42}
        clipPath={`url(#${botClip})`}
      />
      {/* cursor underscore */}
      {showCursor && (
        <path d="M54 62 L66 62" stroke={stroke} strokeWidth="7.5" strokeLinecap="round" />
      )}
      {/* loyalty-points star */}
      <path
        className="th-star"
        d="M68 20 L70.5 26.6 L77.5 26.9 L72 31.3 L73.9 38.1 L68 34.2 L62.1 38.1 L64 31.3 L58.5 26.9 L65.5 26.6 Z"
        fill={star}
      />
    </svg>
  );
}

export function TripyLogo({
  className = '',
  size = 40,
  showText = true,
  href = '/',
  variant = 'default',
}: TripyLogoProps) {
  const { trips, hacker } = VARIANTS[variant];

  const logoContent = (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="relative group">
        <TripsHackerMark
          size={size}
          variant={variant}
          className="transition-transform duration-200 group-hover:scale-105"
        />
      </div>
      {showText && (
        <span
          className="font-display text-2xl font-extrabold"
          style={{ letterSpacing: '-0.03em', lineHeight: 1 }}
        >
          <span style={{ color: trips }}>trips</span>
          <span style={{ color: hacker }}>hacker</span>
        </span>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="inline-block">
        {logoContent}
      </Link>
    );
  }

  return logoContent;
}
