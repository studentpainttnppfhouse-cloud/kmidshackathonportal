-- =============================================================================
-- 0070 SEED
-- The six departments plus the General space, and the event-day reference data.
-- Safe to re-run: every insert is idempotent on a natural key.
-- =============================================================================

insert into public.departments (name, slug, description, color, sort_order) values
  ('Sponsorship & Partnerships', 'sponsorship',
   'Sponsor outreach, MOUs, prize tiers and partner deliverables.', '#EC4899', 1),
  ('Social Media & External Affairs', 'social-media',
   'Content calendar, platform accounts, public communications.', '#DB2777', 2),
  ('Film/Photo & Tech', 'film-photo-tech',
   'Video, photography, livestream and event technology.', '#BE185D', 3),
  ('Documentation', 'documentation',
   'Rubrics, run sheets, handbooks and the written record.', '#C05B86', 4),
  ('Operations', 'operations',
   'Venue, logistics, catering, scheduling and volunteers.', '#8E6C86', 5),
  ('Mentorship', 'mentorship',
   'Mentor recruitment, matching and team support.', '#7C6E86', 6)
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      color = excluded.color,
      sort_order = excluded.sort_order;

-- The run sheet skeleton for 20-21 March 2027.
insert into public.event_items (day, start_time, end_time, title, location, sort_order)
values
  ('2027-03-20', '07:00', '08:00', 'Staff call time & setup',      'Building 7F lobby',  1),
  ('2027-03-20', '08:00', '09:00', 'Participant registration',     '7F entrance',        2),
  ('2027-03-20', '09:00', '09:45', 'Opening ceremony',             'Main hall',          3),
  ('2027-03-20', '09:45', '10:15', 'Theme reveal & briefing',      'Main hall',          4),
  ('2027-03-20', '10:15', '12:30', 'Hacking block 1',              'Team tables',        5),
  ('2027-03-20', '12:30', '13:30', 'Lunch',                        '7F cafeteria',       6),
  ('2027-03-20', '13:30', '17:00', 'Hacking block 2',              'Team tables',        7),
  ('2027-03-20', '17:00', '18:00', 'Mentor office hours',          'Mentor corner',      8),
  ('2027-03-21', '08:00', '09:00', 'Staff call time',              'Building 7F lobby',  9),
  ('2027-03-21', '09:00', '12:00', 'Hacking block 3 (final push)', 'Team tables',       10),
  ('2027-03-21', '12:00', '13:00', 'Submission deadline & lunch',  '7F cafeteria',      11),
  ('2027-03-21', '13:00', '15:30', 'Judging rounds',               'Judging rooms A-C', 12),
  ('2027-03-21', '15:30', '16:30', 'Finals & presentations',       'Main hall',         13),
  ('2027-03-21', '16:30', '17:30', 'Awards & closing',             'Main hall',         14)
on conflict do nothing;

insert into public.quick_reference (category, label, value, sort_order) values
  ('WiFi',      'Network',            'KMIDS-EVENT',                    1),
  ('WiFi',      'Password',           'hackathon2027',                  2),
  ('Venue',     'Floor',              'KMIDS Building, 7th floor',      3),
  ('Venue',     'Judging rooms',      'A (7-04), B (7-05), C (7-06)',   4),
  ('Venue',     'Team tables',        'Tables 1-24, main hall',         5),
  ('Emergency', 'School nurse',       'Ext. 1122 · 7F first-aid point', 6),
  ('Emergency', 'Security desk',      'Ext. 1100 · ground floor',       7),
  ('Emergency', 'Ambulance (Thailand)', '1669',                         8)
on conflict do nothing;

insert into public.social_accounts (platform, handle, url) values
  ('Instagram', '@kmidshackathon', 'https://instagram.com/kmidshackathon'),
  ('TikTok',    '@kmidshackathon', 'https://tiktok.com/@kmidshackathon'),
  ('Facebook',  'KMIDS Hackathon', 'https://facebook.com/kmidshackathon')
on conflict do nothing;
