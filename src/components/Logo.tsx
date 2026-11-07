import Link from 'next/link';
import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  textSize?: string;
}

export function Logo({ className, textSize = 'text-2xl' }: LogoProps) {
  return (
    <Link
      href="/dashboard"
      className={cn(
        'flex items-center gap-2 rounded-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className
      )}
    >
      <span className={cn('font-headline font-bold tracking-tight whitespace-nowrap', textSize)}>
        DDS Gym Tracker
      </span>
    </Link>
  );
}
