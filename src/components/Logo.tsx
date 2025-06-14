import Link from 'next/link';
import { Dumbbell } from 'lucide-react';

interface LogoProps {
  className?: string;
  iconSize?: number;
  textSize?: string;
}

export function Logo({ className, iconSize = 24, textSize = 'text-2xl' }: LogoProps) {
  return (
    <Link href="/dashboard" className={`flex items-center gap-2 ${className}`}>
      <Dumbbell className="text-primary" size={iconSize} />
      <span className={`font-headline font-bold ${textSize} text-primary`}>
        DDS Gym Tracker
      </span>
    </Link>
  );
}
