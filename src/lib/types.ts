/** Shared domain types. Mirrors the database schema in supabase/migrations. */

export const TIERS = ['T0', 'T1', 'T2', 'T3', 'T4'] as const;
export type Tier = (typeof TIERS)[number];

export const ACCOUNT_STATUSES = [
  'active',
  'pending',
  'requested',
  'suspended',
  'banned',
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ASSIGNMENT_STATUSES = [
  'not_started',
  'in_progress',
  'needs_review',
  'approved',
  'done',
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const DOC_STATUSES = ['draft', 'in_review', 'approved', 'published'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const PERMISSION_LEVELS = ['view', 'comment', 'edit'] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export const CONTENT_STATUSES = [
  'idea',
  'assigned',
  'asset_in_progress',
  'ready',
  'posted',
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
export type ShirtSize = (typeof SHIRT_SIZES)[number];

export interface Department {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  head_user_id: string | null;
  color: string;
  sort_order: number;
}

export interface AppUser {
  id: string;
  email: string;
  name: string | null;
  nickname: string | null;
  grade: string | null;
  phone: string | null;
  line_id: string | null;
  avatar_url: string | null;
  shirt_size: ShirtSize | null;
  tier: Tier;
  department_id: string | null;
  role_title: string | null;
  status: AccountStatus;
  is_reserve: boolean;
  is_mentor: boolean;
  is_alumni: boolean;
  banned_by: string | null;
  banned_at: string | null;
  ban_reason: string | null;
  suspended_until: string | null;
  last_active_at: string | null;
  source_response_id: string | null;
  onboarded_at: string | null;
}

/** The identity attached to the current request, after middleware. */
export interface SessionUser extends AppUser {
  /** Set when an Owner is previewing the app as a lower tier. */
  impersonating: Tier | null;
  /** The tier permission checks should use — the impersonated one, if any. */
  effectiveTier: Tier;
}

export const TIER_META: Record<Tier, { label: string; short: string; color: string }> = {
  T0: { label: 'T0 Advisor', short: 'Advisor', color: '#64748B' },
  T1: { label: 'T1 Member', short: 'Member', color: '#0EA5E9' },
  T2: { label: 'T2 Head', short: 'Department Head', color: '#EC4899' },
  T3: { label: 'T3 Admin', short: 'Administration', color: '#BE185D' },
  T4: { label: 'T4 Owner', short: 'Owner', color: '#7C3AED' },
};

export const ASSIGNMENT_STATUS_META: Record<
  AssignmentStatus,
  { label: string; color: string }
> = {
  not_started: { label: 'Not started', color: '#94A3B8' },
  in_progress: { label: 'In progress', color: '#EC4899' },
  needs_review: { label: 'Needs review', color: '#F59E0B' },
  approved: { label: 'Approved', color: '#2DD4BF' },
  done: { label: 'Done', color: '#22C55E' },
};

export const CONTENT_STATUS_META: Record<ContentStatus, { label: string; color: string }> = {
  idea: { label: 'Idea', color: '#94A3B8' },
  assigned: { label: 'Assigned', color: '#EC4899' },
  asset_in_progress: { label: 'Asset in progress', color: '#F59E0B' },
  ready: { label: 'Ready', color: '#2DD4BF' },
  posted: { label: 'Posted', color: '#22C55E' },
};

/** 20-21 March 2027, KMIDS Building 7th floor, Bangkok. */
export const EVENT_START = '2027-03-20';
export const EVENT_END = '2027-03-21';
/** Event-Day Mode activates on the 19th (setup day). */
export const EVENT_MODE_START = '2027-03-19';
export const CURRENT_YEAR = 2027;
