import type { NavItem } from '@/types';
import { LayoutDashboard, Dumbbell, ListChecks, ClipboardEdit, CalendarDays } from 'lucide-react';

export const siteConfig = {
  name: "GymFlow",
  description: "Manage exercises, build routines, and log your workouts with GymFlow.",
  url: "https://gymflow.example.com", // Replace with your actual URL
  ogImage: "https://gymflow.example.com/og.jpg", // Replace with your actual OG image
  links: {
    twitter: "https://twitter.com/gymflow", // Replace
    github: "https://github.com/your-repo/gymflow", // Replace
  },
};

export const navItems: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    label: 'Dashboard',
  },
  {
    title: 'Exercises',
    href: '/exercises',
    icon: Dumbbell,
    label: 'Exercises',
  },
  {
    title: 'Routines',
    href: '/routines',
    icon: ListChecks,
    label: 'Routines',
  },
  {
    title: 'Training Log',
    href: '/log',
    icon: ClipboardEdit,
    label: 'Training Log',
  },
  {
    title: 'Calendar',
    href: '/calendar',
    icon: CalendarDays,
    label: 'Training Calendar',
  },
];
