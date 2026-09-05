import type { NavItem } from '@/types';
import { LayoutDashboard, Dumbbell, ListChecks, ClipboardEdit } from 'lucide-react';

export const siteConfig = {
  name: "DDS Gym Tracker",
  description: "Manage exercises, build routines, and log your workouts with DDS Gym Tracker.",
  url: "https://ddsgymtracker.example.com", // Replace with your actual URL
  ogImage: "https://ddsgymtracker.example.com/og.jpg", // Replace with your actual OG image
  links: {
    twitter: "https://twitter.com/ddsgymtracker", // Replace
    github: "https://github.com/Dalmiro47/GymTrackerv2",
  },
};

// Primary navigation (BottomNav on mobile, AppSidebar on desktop).
// /profile is deliberately NOT here — it is reached from the avatar menu
// in the app bar (see <UserNav />). `title` is a translation key: render it
// through `t(item.title)`.
export const navItems: NavItem[] = [
  {
    title: 'nav.dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    title: 'nav.log',
    href: '/log',
    icon: ClipboardEdit,
  },
  {
    title: 'nav.exercises',
    href: '/exercises',
    icon: Dumbbell,
  },
  {
    title: 'nav.routines',
    href: '/routines',
    icon: ListChecks,
  },
];
