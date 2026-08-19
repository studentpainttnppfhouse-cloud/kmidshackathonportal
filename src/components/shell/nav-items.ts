import type { LucideIcon } from 'lucide-react';
import {
  Activity, Calendar, CheckSquare, ClipboardList, FileText, Grid3x3,
  Home, Image, Layers, LayoutTemplate, Shield, Users,
} from 'lucide-react';
import type { Tier } from '@/lib/types';
import { canSeeOwnerConsole } from '@/lib/permissions';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown with a padlock rather than hidden, so the hierarchy stays legible. */
  locked?: boolean;
}

/** Sidebar order, lifted from the design export. */
export function navItems(tier: Tier): NavItem[] {
  return [
    { href: '/dashboard', label: 'Dashboard', icon: Home },
    { href: '/people', label: 'People & Org', icon: Users },
    { href: '/workspace', label: 'Department', icon: Layers },
    { href: '/assignments', label: 'Assignments', icon: CheckSquare },
    { href: '/documents', label: 'Documents', icon: FileText },
    { href: '/spreadsheets', label: 'Spreadsheets', icon: Grid3x3 },
    { href: '/files', label: 'Files & Brand', icon: Image },
    { href: '/forms', label: 'Forms', icon: ClipboardList },
    { href: '/social', label: 'Social Calendar', icon: Calendar },
    { href: '/event-day', label: 'Event-Day', icon: Activity },
    { href: '/owner', label: 'Owner Console', icon: Shield, locked: !canSeeOwnerConsole(tier) },
    { href: '/kit', label: 'States & Kit', icon: LayoutTemplate },
  ];
}

export const SCREEN_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/people': 'People & Org Chart',
  '/workspace': 'Department Workspace',
  '/assignments': 'Assignments',
  '/documents': 'Documents',
  '/spreadsheets': 'Spreadsheets',
  '/files': 'Files & Brand Kit',
  '/forms': 'Forms',
  '/social': 'Social Content Calendar',
  '/event-day': 'Event-Day Mode',
  '/owner': 'Owner Console',
  '/kit': 'States & Component Kit',
  '/settings': 'Settings',
};

export function titleFor(pathname: string): string {
  const exact = SCREEN_TITLES[pathname];
  if (exact) return exact;
  const base = Object.keys(SCREEN_TITLES).find(
    (k) => k !== '/' && pathname.startsWith(k),
  );
  return base ? (SCREEN_TITLES[base] ?? 'Hackathon Studio') : 'Hackathon Studio';
}
