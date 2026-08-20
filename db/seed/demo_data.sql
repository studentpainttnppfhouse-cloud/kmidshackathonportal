-- =============================================================================
-- DEMO / STARTER DATA
--
-- Optional. Run this after the migrations to get a portal with content in it
-- rather than a set of empty screens — useful for showing the team what this
-- is, and for finding layout problems that only appear with real data.
--
--   npm run db:setup -- --seed
--   psql "$DATABASE_URL" -f db/seed/demo_data.sql
--
-- Safe to re-run. A teardown block is at the bottom of the file.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- People
-- Nicknames are how Thai students actually refer to each other, so the
-- directory leads with those and keeps the full name as secondary.
-- ---------------------------------------------------------------------------
insert into public.users
  (email, name, nickname, grade, phone, line_id, shirt_size, tier,
   department_id, role_title, status, is_reserve, is_mentor, onboarded_at)
values
  ('june@kmids.ac.th',   'June Sirikul',    'June',   'G12',     '081-234-0001', '@junes',    'M', 'T4',
    null, 'Event Owner', 'active', false, false, now()),
  ('somsak@kmids.ac.th', 'Ajarn Somsak P.', 'A. Som', 'Teacher', '081-234-0002', '@ajarnsom', 'L', 'T0',
    null, 'Faculty Advisor', 'active', false, false, now()),
  ('nira@kmids.ac.th',   'Nira Chaiwat',    'Nira',   'G12',     '081-234-0003', '@nira',     'S', 'T3',
    null, 'Deputy Director', 'active', false, false, now()),

  ('praewa@kmids.ac.th', 'Praewa Thanakit', 'Prae',   'G11', '081-234-0010', '@praewa', 'S', 'T2',
    (select id from public.departments where slug='sponsorship'), 'Sponsorship Lead', 'active', false, false, now()),
  ('jira@kmids.ac.th',   'Jira Ratanakul',  'Jira',   'G10', '081-234-0011', '@jirar',  'M', 'T1',
    (select id from public.departments where slug='sponsorship'), 'Outreach', 'active', false, false, now()),
  ('mild@kmids.ac.th',   'Mild Voraphan',   'Mild',   'G10', '081-234-0012', '@mildv',  'S', 'T1',
    (select id from public.departments where slug='sponsorship'), 'Partnerships', 'active', false, false, now()),

  ('ploy@kmids.ac.th',   'Ploy Sattaya',    'Ploy',   'G11', '081-234-0020', '@ploys',  'S', 'T2',
    (select id from public.departments where slug='social-media'), 'Social Lead', 'active', false, false, now()),
  ('tar@kmids.ac.th',    'Tar Nopphon',     'Tar',    'G10', '081-234-0021', '@tarn',   'L', 'T1',
    (select id from public.departments where slug='social-media'), 'Copywriter', 'active', false, false, now()),

  ('kao@kmids.ac.th',    'Kao Kittipong',   'Kao',    'G10', '081-234-0030', '@kaok',   'M', 'T2',
    (select id from public.departments where slug='film-photo-tech'), 'Film & Tech Head', 'active', false, false, now()),
  ('bank@kmids.ac.th',   'Bank Aticha',     'Bank',   'G11', '081-234-0031', '@banka',  'L', 'T1',
    (select id from public.departments where slug='film-photo-tech'), 'Videographer', 'active', false, false, now()),

  ('mint@kmids.ac.th',   'Mint Natcha',     'Mint',   'G11', '081-234-0040', '@mintn',  'S', 'T2',
    (select id from public.departments where slug='documentation'), 'Documentation Head', 'active', false, false, now()),

  ('napat@kmids.ac.th',  'Napat Wongsiri',  'Napat',  'G12', '081-234-0050', '@napatw', 'M', 'T2',
    (select id from public.departments where slug='operations'), 'Operations Head', 'active', false, false, now()),
  ('aim@kmids.ac.th',    'Aim Pichaya',     'Aim',    'G10', '081-234-0051', '@aimp',   'S', 'T1',
    (select id from public.departments where slug='operations'), 'Logistics', 'active', true, false, now()),
  ('gun@kmids.ac.th',    'Gun Thanadech',   'Gun',    'G10', '081-234-0052', '@gunt',   'M', 'T1',
    (select id from public.departments where slug='operations'), 'Volunteer Coordinator', 'active', true, false, now()),

  ('beam@kmids.ac.th',   'Beam Kanyarat',   'Beam',   'G10', '081-234-0060', '@beamk',  'S', 'T2',
    (select id from public.departments where slug='mentorship'), 'Mentorship Coordinator', 'active', false, true, now()),
  ('film@kmids.ac.th',   'Film Chayut',     'Film',   'G11', '081-234-0061', '@filmc',  'M', 'T1',
    (select id from public.departments where slug='mentorship'), 'Mentor Liaison', 'active', false, true, now()),

  -- Someone waiting in the access-request queue, so the Owner Console has
  -- something real to approve.
  ('newbie@kmids.ac.th', null, null, null, null, null, null, 'T1',
    null, null, 'requested', false, false, null)
on conflict (email) do update set
  name = excluded.name, nickname = excluded.nickname, grade = excluded.grade,
  phone = excluded.phone, line_id = excluded.line_id, shirt_size = excluded.shirt_size,
  tier = excluded.tier, department_id = excluded.department_id,
  role_title = excluded.role_title, status = excluded.status,
  is_reserve = excluded.is_reserve, is_mentor = excluded.is_mentor,
  onboarded_at = excluded.onboarded_at;

update public.departments d set head_user_id = u.id
from public.users u
where (d.slug, u.email) in (
  ('sponsorship','praewa@kmids.ac.th'), ('social-media','ploy@kmids.ac.th'),
  ('film-photo-tech','kao@kmids.ac.th'), ('documentation','mint@kmids.ac.th'),
  ('operations','napat@kmids.ac.th'), ('mentorship','beam@kmids.ac.th')
);

-- ---------------------------------------------------------------------------
-- Assignments — spread across every status and both sides of the due date, so
-- the board, the overdue panel and the approval queue all have something in
-- them.
-- ---------------------------------------------------------------------------
insert into public.assignments
  (title, description, department_id, created_by, due_date, priority, status)
select v.title, v.description,
       (select id from public.departments where slug = v.dept),
       (select id from public.users where email = v.creator),
       current_date + v.due_offset, v.priority::app.priority, v.status::app.assignment_status
from (values
  ('Collect signed MOU from BDMS',
   'Follow up with the BDMS partnerships team to get the co-branding MOU signed. Scan and upload to the sponsorship folder once returned.',
   'sponsorship','praewa@kmids.ac.th',-2,'high','needs_review'),
  ('Confirm 3 sponsor logos for the banner',
   'Chase final vector files. PNG is not good enough for the A0 print.',
   'sponsorship','praewa@kmids.ac.th',0,'high','in_progress'),
  ('Draft outreach email to Bumrungrad',
   'Short intro, what we are asking for, and the prize tier one-pager attached.',
   'sponsorship','praewa@kmids.ac.th',1,'medium','not_started'),
  ('Sponsor tier one-pager',
   'Bronze through Platinum, what each tier gets, and the deadline to commit.',
   'sponsorship','praewa@kmids.ac.th',4,'medium','needs_review'),
  ('Promo reel storyboard',
   'Sixty seconds, vertical. Opens on the ECG motif, ends on the date card.',
   'film-photo-tech','kao@kmids.ac.th',2,'high','in_progress'),
  ('Test the livestream setup in the main hall',
   'Bring the capture card. Check the 7F wifi actually holds an upload.',
   'film-photo-tech','kao@kmids.ac.th',9,'medium','not_started'),
  ('Judging rubric v3',
   'Weight clinical impact at 40%. Add the feasibility tie-breaker the judges asked for.',
   'documentation','mint@kmids.ac.th',1,'high','needs_review'),
  ('Registration form copy',
   'Plain language. Assume a G9 reading it on a phone.',
   'documentation','mint@kmids.ac.th',-12,'medium','approved'),
  ('Venue floor plan',
   '24 team tables, judging rooms A-C, mentor corner, first aid point.',
   'operations','napat@kmids.ac.th',0,'high','needs_review'),
  ('Book the judges dinner',
   'Eight people, evening of the 21st, somewhere walkable from school.',
   'operations','napat@kmids.ac.th',6,'medium','not_started'),
  ('Draft the volunteer schedule',
   'Two shifts per day, and make sure the reserves are not all rostered at once.',
   'operations','napat@kmids.ac.th',8,'medium','not_started'),
  ('Reserve room 7B for planning syncs',
   'Every Thursday through March.',
   'operations','napat@kmids.ac.th',-20,'low','done'),
  ('Theme announcement post',
   'Goes out the same hour the theme is revealed. Have it queued.',
   'social-media','ploy@kmids.ac.th',-15,'medium','done'),
  ('Countdown post series',
   'Seven posts, one a day. Same template, different stat each time.',
   'social-media','ploy@kmids.ac.th',5,'medium','in_progress'),
  ('Confirm 12 mentors for both days',
   'Need at least four with a clinical background.',
   'mentorship','beam@kmids.ac.th',3,'urgent','in_progress'),
  ('Write the mentor briefing pack',
   'What to help with, what to leave alone, and the judging criteria.',
   'mentorship','beam@kmids.ac.th',7,'medium','not_started')
) as v(title, description, dept, creator, due_offset, priority, status)
where not exists (select 1 from public.assignments a where a.title = v.title);

insert into public.assignment_assignees (assignment_id, user_id)
select a.id, u.id
from public.assignments a
join (values
  ('Collect signed MOU from BDMS','jira@kmids.ac.th'),
  ('Confirm 3 sponsor logos for the banner','praewa@kmids.ac.th'),
  ('Draft outreach email to Bumrungrad','mild@kmids.ac.th'),
  ('Sponsor tier one-pager','mild@kmids.ac.th'),
  ('Promo reel storyboard','bank@kmids.ac.th'),
  ('Test the livestream setup in the main hall','kao@kmids.ac.th'),
  ('Judging rubric v3','mint@kmids.ac.th'),
  ('Registration form copy','mint@kmids.ac.th'),
  ('Venue floor plan','napat@kmids.ac.th'),
  ('Book the judges dinner','aim@kmids.ac.th'),
  ('Draft the volunteer schedule','gun@kmids.ac.th'),
  ('Reserve room 7B for planning syncs','aim@kmids.ac.th'),
  ('Theme announcement post','ploy@kmids.ac.th'),
  ('Countdown post series','tar@kmids.ac.th'),
  ('Confirm 12 mentors for both days','beam@kmids.ac.th'),
  ('Write the mentor briefing pack','film@kmids.ac.th')
) as m(title, email) on m.title = a.title
join public.users u on u.email = m.email
on conflict do nothing;

-- Comments on the overdue item, so the task drawer has a thread in it.
insert into public.comments (parent_type, parent_id, user_id, body, created_at)
select 'assignment', a.id, u.id, v.body, now() - (v.ago || ' hours')::interval
from public.assignments a, public.users u,
  (values
    ('napat@kmids.ac.th','Any update on this? We need it before Thursday''s review.','3'),
    ('jira@kmids.ac.th','Chased them again this morning. Their legal team has it, promised by Friday.','1')
  ) as v(email, body, ago)
where a.title = 'Collect signed MOU from BDMS' and u.email = v.email
  and not exists (select 1 from public.comments c where c.parent_id = a.id and c.body = v.body);

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------
insert into public.announcements (title, body, scope, department_id, author_id, pinned)
select v.title, v.body, v.scope::app.announcement_scope,
       (select id from public.departments where slug = v.dept),
       (select id from public.users where email = v.author), v.pinned
from (values
  ('Event dates are locked: 20-21 March',
   'Building 7, seventh floor. Staff call time is 07:00 on the Friday. Put it in your calendar now and tell your parents.',
   'all', null, 'june@kmids.ac.th', true),
  ('Shirt sizes needed by Friday',
   'If you have not filled in your shirt size in Settings, please do it this week. The print run closes and we cannot add to it later.',
   'all', null, 'nira@kmids.ac.th', false),
  ('Sponsor deck review moved to Thursday 4pm',
   'Bring your latest numbers. If you have a maybe, still bring it — a maybe is useful.',
   'department', 'sponsorship', 'praewa@kmids.ac.th', false),
  ('Room 7B is ours through March',
   'Booked for all planning syncs. Do not leave equipment overnight, it gets cleared.',
   'department', 'operations', 'napat@kmids.ac.th', false)
) as v(title, body, scope, dept, author, pinned)
where not exists (select 1 from public.announcements a where a.title = v.title);

commit;

begin;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
insert into public.documents (title, department_id, owner_id, status, tags, content, plain_text)
select v.title,
       (select id from public.departments where slug = v.dept),
       (select id from public.users where email = v.owner),
       v.status::app.doc_status, v.tags::text[], v.content::jsonb, v.plain
from (values
  ('Judging rubric v3','documentation','mint@kmids.ac.th','in_review','{judging,rubric}',
   '{"type":"doc","content":[
      {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Judging rubric"}]},
      {"type":"paragraph","content":[{"type":"text","text":"Every team is scored out of 100 across four criteria. Judges score independently, then reconcile."}]},
      {"type":"bulletList","content":[
        {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","marks":[{"type":"bold"}],"text":"Clinical impact - 40%. "},{"type":"text","text":"Does this solve a problem a real patient or clinician has?"}]}]},
        {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","marks":[{"type":"bold"}],"text":"Feasibility - 25%. "},{"type":"text","text":"Could a small team actually build this in six months?"}]}]},
        {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","marks":[{"type":"bold"}],"text":"Technical execution - 20%. "},{"type":"text","text":"How much of it genuinely works today?"}]}]},
        {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","marks":[{"type":"bold"}],"text":"Presentation - 15%. "},{"type":"text","text":"Five minutes, clear, no jargon."}]}]}
      ]},
      {"type":"paragraph","content":[{"type":"text","text":"Ties break on feasibility."}]}]}',
   'Judging rubric. Every team is scored out of 100 across four criteria. Clinical impact 40%. Feasibility 25%. Technical execution 20%. Presentation 15%. Ties break on feasibility.'),

  ('Run of show - 20 March','operations','napat@kmids.ac.th','approved','{event,logistics}',
   '{"type":"doc","content":[
      {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Friday 20 March"}]},
      {"type":"paragraph","content":[{"type":"text","text":"Staff call time is 07:00. Doors to participants at 08:00."}]},
      {"type":"taskList","content":[
        {"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"Tables numbered and power run"}]}]},
        {"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"Registration desk staffed from 07:45"}]}]},
        {"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"Judges briefed before 09:00"}]}]}
      ]}]}',
   'Friday 20 March. Staff call time is 07:00. Doors to participants at 08:00. Tables numbered and power run. Registration desk staffed from 07:45. Judges briefed before 09:00.'),

  ('Sponsor tiers 2027','sponsorship','praewa@kmids.ac.th','draft','{sponsorship}',
   '{"type":"doc","content":[
      {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"What each tier gets"}]},
      {"type":"paragraph","content":[{"type":"text","text":"Draft - numbers still to be confirmed with Nira."}]}]}',
   'What each tier gets. Draft, numbers still to be confirmed with Nira.')
) as v(title, dept, owner, status, tags, content, plain)
where not exists (select 1 from public.documents d where d.title = v.title);

-- ---------------------------------------------------------------------------
-- A recruitment form, with the section branching the brief calls for
-- ---------------------------------------------------------------------------
insert into public.forms
  (title, description, department_id, owner_id, status, public_slug, schema, settings)
values (
  'Staff recruitment - Hackathon 2027',
  'We are building the team for KMIDS Hackathon 2027. Tell us where you would like to help. Takes about three minutes.',
  null, (select id from public.users where email='june@kmids.ac.th'), 'published', 'staff-2027',
  '{"fields":[
    {"id":"f_name","type":"short_text","label":"Your full name","required":true},
    {"id":"f_nick","type":"short_text","label":"Nickname","required":true,"help":"What everyone actually calls you."},
    {"id":"f_grade","type":"dropdown","label":"Grade","required":true,"options":["G9","G10","G11","G12"]},
    {"id":"f_sec1","type":"section","label":"Where you want to help"},
    {"id":"f_dept","type":"radio","label":"First choice department","required":true,
      "options":["Sponsorship & Partnerships","Social Media & External Affairs","Film/Photo & Tech","Documentation","Operations","Mentorship"]},
    {"id":"f_portfolio","type":"url","label":"Link to your portfolio or reel",
      "help":"Only if you have one - it is not required.",
      "condition":{"fieldId":"f_dept","equals":"Film/Photo & Tech"}},
    {"id":"f_writing","type":"paragraph","label":"Write us two sentences of caption copy for a countdown post",
      "condition":{"fieldId":"f_dept","equals":"Social Media & External Affairs"}},
    {"id":"f_contacts","type":"paragraph","label":"Have you contacted a sponsor or partner before? Tell us about it.",
      "condition":{"fieldId":"f_dept","equals":"Sponsorship & Partnerships"}},
    {"id":"f_sec2","type":"section","label":"Availability"},
    {"id":"f_days","type":"checkboxes","label":"Which days can you be there in person?","required":true,
      "options":["Thu 19 March (setup)","Fri 20 March","Sat 21 March"]},
    {"id":"f_commit","type":"linear_scale","label":"Hours a week you can give between now and March",
      "min":1,"max":10,"minLabel":"An hour","maxLabel":"Ten or more"},
    {"id":"f_reserve","type":"radio","label":"Happy to be a reserve if your first choice is full?",
      "options":["Yes","No"],"required":true},
    {"id":"f_shirt","type":"dropdown","label":"Shirt size","options":["XS","S","M","L","XL","XXL"]},
    {"id":"f_anything","type":"paragraph","label":"Anything else we should know?"}
  ]}'::jsonb,
  '{"loginRequired":false,"oneResponsePerUser":false,"allowEditAfterSubmit":true,
    "confirmationMessage":"Thanks - we read every one of these. You will hear from us within a week."}'::jsonb
)
on conflict (public_slug) do update set
  schema = excluded.schema, settings = excluded.settings, status = excluded.status;

insert into public.form_responses (form_id, respondent_email, payload, submitted_at)
select f.id, r.email, r.payload::jsonb, now() - (r.ago || ' hours')::interval
from public.forms f,
  (values
    ('tanya@kmids.ac.th','6',
     '{"f_name":"Tanya Boonmee","f_nick":"Tan","f_grade":"G10","f_dept":"Film/Photo & Tech","f_portfolio":"https://vimeo.com/example","f_days":["Fri 20 March","Sat 21 March"],"f_commit":6,"f_reserve":"Yes","f_shirt":"S","f_anything":"I edit on Premiere and shoot on a Sony A7III I own."}'),
    ('pete@kmids.ac.th','20',
     '{"f_name":"Pete Ariyawat","f_nick":"Pete","f_grade":"G11","f_dept":"Sponsorship & Partnerships","f_contacts":"I helped get a cafe to sponsor our class trip last year, mostly by just walking in and asking.","f_days":["Thu 19 March (setup)","Fri 20 March","Sat 21 March"],"f_commit":8,"f_reserve":"No","f_shirt":"L"}'),
    ('nook@kmids.ac.th','30',
     '{"f_name":"Nook Siriporn","f_nick":"Nook","f_grade":"G9","f_dept":"Social Media & External Affairs","f_writing":"48 hours. One floor. Every team building something a hospital could actually use. Doors open 20 March.","f_days":["Fri 20 March"],"f_commit":3,"f_reserve":"Yes","f_shirt":"XS","f_anything":"I run my art account with 4k followers if that helps."}'),
    ('view@kmids.ac.th','52',
     '{"f_name":"View Chanidapa","f_nick":"View","f_grade":"G10","f_dept":"Operations","f_days":["Thu 19 March (setup)","Fri 20 March","Sat 21 March"],"f_commit":10,"f_reserve":"Yes","f_shirt":"M","f_anything":"Happy to do the boring jobs nobody wants."}')
  ) as r(email, ago, payload)
where f.public_slug = 'staff-2027'
  and not exists (
    select 1 from public.form_responses fr
    where fr.form_id = f.id and fr.respondent_email = r.email
  );

-- ---------------------------------------------------------------------------
-- Social content calendar
-- ---------------------------------------------------------------------------
insert into public.content_items
  (scheduled_date, platform, format, caption, status, designer_id, editor_id, poster_id, department_id)
select v.d::date, v.platform, v.format, v.caption, v.status::app.content_status,
       (select id from public.users where email = v.designer),
       (select id from public.users where email = v.editor),
       (select id from public.users where email = v.poster),
       (select id from public.departments where slug='social-media')
from (values
  ('2027-03-03','Instagram','Carousel','Theme reveal - MedTech & Digital Health.','posted','ploy@kmids.ac.th','tar@kmids.ac.th','ploy@kmids.ac.th'),
  ('2027-03-07','TikTok','Reel','Countdown 1 - what actually happens at a hackathon.','ready','bank@kmids.ac.th','kao@kmids.ac.th','ploy@kmids.ac.th'),
  ('2027-03-10','Instagram','Post','Judge spotlight - Dr Anong, cardiology.','asset_in_progress','ploy@kmids.ac.th',null,'tar@kmids.ac.th'),
  ('2027-03-14','Facebook','Post','Thank you to our sponsors.','assigned','tar@kmids.ac.th',null,null),
  ('2027-03-18','Instagram','Story','Day-before hype - setup timelapse.','idea',null,null,null),
  ('2027-03-20','Instagram','Story','Live: opening ceremony.','idea',null,null,null)
) as v(d, platform, format, caption, status, designer, editor, poster)
where not exists (
  select 1 from public.content_items c
  where c.scheduled_date = v.d::date and c.caption = v.caption
);

update public.social_accounts sa set access_holder_user_id = u.id
from public.users u
where (sa.platform, u.email) in (
  ('Instagram','ploy@kmids.ac.th'),
  ('TikTok','bank@kmids.ac.th'),
  ('Facebook','ploy@kmids.ac.th')
);

commit;

-- =============================================================================
-- Teardown — removes everything this file created.
--
--   begin;
--   set session_replication_role = replica;  -- suspend the soft-delete triggers
--   delete from public.comments;
--   delete from public.form_responses;
--   delete from public.forms where public_slug = 'staff-2027';
--   delete from public.content_items;
--   delete from public.documents;
--   delete from public.announcements;
--   delete from public.assignment_assignees;
--   delete from public.assignments;
--   update public.departments set head_user_id = null;
--   update public.social_accounts set access_holder_user_id = null;
--   delete from public.users where email like '%@kmids.ac.th';
--   set session_replication_role = origin;
--   commit;
--
-- Keep your own Owner account out of that users DELETE if it shares the domain.
-- =============================================================================
