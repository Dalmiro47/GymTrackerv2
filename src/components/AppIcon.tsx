import { cn } from '@/lib/utils';

interface AppIconProps {
  /** Rendered width/height in px. */
  size?: number;
  className?: string;
}

/**
 * The "Iron Glass" app icon (2026-09) as inline SVG, so the in-app logo is
 * pixel-identical to the PWA tile. Master file: public/logo.svg — keep both in sync.
 */
export function AppIcon({ size = 24, className }: AppIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0', className)}
    >
      <defs>
        <linearGradient id="ai-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1C2942" />
          <stop offset="0.55" stopColor="#0E1526" />
          <stop offset="1" stopColor="#070B14" />
        </linearGradient>
        <radialGradient id="ai-glow" cx="0.5" cy="0.1" r="0.7">
          <stop offset="0" stopColor="#38BDF8" stopOpacity="0.32" />
          <stop offset="1" stopColor="#38BDF8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ai-outer" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B6ECFF" />
          <stop offset="0.45" stopColor="#38BDF8" />
          <stop offset="1" stopColor="#0284C7" />
        </linearGradient>
        <linearGradient id="ai-inner" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7DD3FC" />
          <stop offset="1" stopColor="#0369A1" />
        </linearGradient>
        <linearGradient id="ai-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5CCBFA" />
          <stop offset="1" stopColor="#075985" />
        </linearGradient>
        <filter id="ai-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#ai-tile)" />
      <rect width="512" height="512" rx="116" fill="url(#ai-glow)" />
      <path d="M0 116 C0 52.2 52.2 0 116 0 H420 L0 420 Z" fill="#FFFFFF" opacity="0.035" />
      <g transform="translate(256 256) rotate(-36) translate(-256 -256)">
        <g transform="translate(8 22)" filter="url(#ai-blur)" opacity="0.7" fill="#020509">
          <rect x="72" y="238" width="368" height="36" rx="18" />
          <rect x="148" y="190" width="36" height="132" rx="12" />
          <rect x="328" y="190" width="36" height="132" rx="12" />
          <rect x="84" y="164" width="60" height="184" rx="18" />
          <rect x="368" y="164" width="60" height="184" rx="18" />
        </g>
        <rect x="72" y="238" width="368" height="36" rx="18" fill="url(#ai-bar)" />
        <rect x="148" y="190" width="36" height="132" rx="12" fill="url(#ai-inner)" />
        <rect x="328" y="190" width="36" height="132" rx="12" fill="url(#ai-inner)" />
        <rect x="84" y="164" width="60" height="184" rx="18" fill="url(#ai-outer)" />
        <rect x="368" y="164" width="60" height="184" rx="18" fill="url(#ai-outer)" />
        <g fill="#FFFFFF">
          <rect x="96" y="174" width="36" height="7" rx="3.5" opacity="0.5" />
          <rect x="380" y="174" width="36" height="7" rx="3.5" opacity="0.5" />
          <rect x="156" y="199" width="20" height="6" rx="3" opacity="0.4" />
          <rect x="336" y="199" width="20" height="6" rx="3" opacity="0.4" />
          <rect x="196" y="245" width="120" height="5" rx="2.5" opacity="0.275" />
        </g>
      </g>
      <rect
        x="1.5"
        y="1.5"
        width="509"
        height="509"
        rx="114.5"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.09"
        strokeWidth="3"
      />
    </svg>
  );
}
