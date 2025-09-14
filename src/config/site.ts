import type { NavItem } from '@/types';
import { LayoutDashboard, Dumbbell, ListChecks, ClipboardEdit, Sparkles } from 'lucide-react'; // Added Sparkles

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

export const navItems: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    label: 'Dashboard',
  },
  {
    title: 'Training Log',
    href: '/log',
    icon: ClipboardEdit,
    label: 'Training Log',
  },
  {
    title: 'AI Coach',
    href: '/coach',
    icon: Sparkles,
    label: 'AI Coach',
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
];
