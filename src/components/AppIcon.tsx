import Image from 'next/image';
import { cn } from '@/lib/utils';

interface AppIconProps {
  /** Rendered width/height in px. */
  size?: number;
  className?: string;
}

/**
 * The app icon (squat illustration, 2026-11) as the generated PWA PNG, so it
 * matches the home-screen tile. Master: assets/brand/squat-master.png, rendered
 * by scripts/gen-icons.mjs. Too detailed for small sizes: the header, sidebar
 * and login show the text logo only.
 */
export function AppIcon({ size = 24, className }: AppIconProps) {
  return (
    <Image
      src="/icons/icon-192.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      unoptimized
      className={cn('shrink-0 rounded-[22%]', className)}
    />
  );
}
