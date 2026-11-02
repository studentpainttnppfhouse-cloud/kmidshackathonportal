-- Four more departments: Graphics, Judging Coordination, Marketing, Accounting.
-- INSERT IGNORE skips any slug that already exists, so this is safe to run on
-- a portal that has some of them already. Slugs match TEAMS in constants.ts.
INSERT IGNORE INTO `departments` (`id`, `name`, `slug`, `description`, `color`, `sortOrder`, `isGeneral`, `createdAt`, `updatedAt`) VALUES
  ('dept_graphics',   'Graphics',              'graphics',   'Posters, social visuals, slides, and the look of everything we put out.', '#F43F5E', 100, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('dept_judging',    'Judging Coordination',  'judging',    'Judges, scoring rubrics, judging schedule, and results on the day.',      '#8B5CF6', 101, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('dept_marketing',  'Marketing',             'marketing',  'Promotion, sign-ups, outreach to schools, and getting people to come.',   '#F97316', 102, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('dept_accounting', 'Accounting',            'accounting', 'Budget, spending, receipts, and the money records.',                      '#10B981', 103, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
