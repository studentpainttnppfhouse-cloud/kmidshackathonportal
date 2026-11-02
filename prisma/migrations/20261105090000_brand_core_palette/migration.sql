-- The core palette used to be a constant in code. It is now editable rows.
INSERT IGNORE INTO `brand_tokens` (`id`, `kind`, `name`, `value`, `groupName`, `note`, `sortOrder`, `createdAt`, `updatedAt`) VALUES
  ('brand_core_00', 'color', 'Primary pink', '#EC4899', 'Core', 'Buttons, active states', -100, NOW(3), NOW(3)),
  ('brand_core_01', 'color', 'Deep pink', '#BE185D', 'Core', 'Headings and emphasis', -99, NOW(3), NOW(3)),
  ('brand_core_02', 'color', 'Pink wash', '#FDF2F8', 'Core', 'Page background (light)', -98, NOW(3), NOW(3)),
  ('brand_core_03', 'color', 'Surface', '#FFFFFF', 'Core', 'Cards and sheets', -97, NOW(3), NOW(3)),
  ('brand_core_04', 'color', 'Body text', '#1F2937', 'Core', 'All running text', -96, NOW(3), NOW(3)),
  ('brand_core_05', 'color', 'Muted', '#64748B', 'Core', 'Secondary text', -95, NOW(3), NOW(3)),
  ('brand_core_06', 'color', 'Success', '#22C55E', 'Core', 'Done, approved', -94, NOW(3), NOW(3)),
  ('brand_core_07', 'color', 'Warning', '#F59E0B', 'Core', 'Needs review', -93, NOW(3), NOW(3)),
  ('brand_core_08', 'color', 'Danger', '#DC2626', 'Core', 'Overdue, incidents', -92, NOW(3), NOW(3)),
  ('brand_core_09', 'color', 'Dark ground', '#17121A', 'Core', 'Page background (dark mode)', -91, NOW(3), NOW(3)),
  ('brand_core_10', 'color', 'Dark surface', '#201A24', 'Core', 'Cards in dark mode', -90, NOW(3), NOW(3)),
  ('brand_core_11', 'color', 'Dark pink', '#F472B6', 'Core', 'Brand pink, lifted for dark mode', -89, NOW(3), NOW(3));
