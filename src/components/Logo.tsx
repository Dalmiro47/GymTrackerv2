import Link from 'next/link';
import { Dumbbell } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  iconSize?: number;
  textSize?: string;
}

export function Logo({ className, iconSize = 24, textSize = 'text-2xl' }: LogoProps) {
  return (
    <Link
      href="/dashboard"
      className={cn(
        'flex items-center gap-2 rounded-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className
      )}
    >
      <Dumbbell className="text-primary shrink-0" size={iconSize} />
      <span className={cn('font-headline font-bold tracking-tight whitespace-nowrap', textSize)}>
        DDS Gym Tracker
      </span>
    </Link>
  );
}
