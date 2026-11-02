-- Names and captions to match the colours the team picked.
-- Each row only changes if it still holds the hex it was written for.
UPDATE `brand_tokens` SET `name` = 'Blush', `note` = 'Soft backgrounds and highlights' WHERE `id` = 'brand_core_00' AND `value` = '#FFD9E4';
UPDATE `brand_tokens` SET `name` = 'Light pink', `note` = 'Tags, hover states and soft fills' WHERE `id` = 'brand_core_01' AND `value` = '#FFC0D2';
UPDATE `brand_tokens` SET `name` = 'Pink', `note` = 'Accents and illustrations' WHERE `id` = 'brand_core_02' AND `value` = '#FF9DBC';
UPDATE `brand_tokens` SET `name` = 'Primary pink', `note` = 'Buttons, links and active states' WHERE `id` = 'brand_core_03' AND `value` = '#ED5C97';
UPDATE `brand_tokens` SET `name` = 'Orchid', `note` = 'Secondary accents' WHERE `id` = 'brand_core_04' AND `value` = '#F5ACE2';
UPDATE `brand_tokens` SET `name` = 'Navy', `note` = 'Headings and body text' WHERE `id` = 'brand_core_05' AND `value` = '#1E2A4A';
UPDATE `brand_tokens` SET `name` = 'Gold', `note` = 'Awards and special highlights' WHERE `id` = 'brand_core_06' AND `value` = '#C9A24B';
UPDATE `brand_tokens` SET `name` = 'Ink black', `note` = 'Text, and the logo on light backgrounds' WHERE `id` = 'brand_core_07' AND `value` = '#14110F';
UPDATE `brand_tokens` SET `name` = 'Off-white', `note` = 'Page background (light mode)' WHERE `id` = 'brand_core_08' AND `value` = '#FBF4F6';
UPDATE `brand_tokens` SET `name` = 'White', `note` = 'Cards, and the logo on dark backgrounds' WHERE `id` = 'brand_core_09' AND `value` = '#FFFFFF';
UPDATE `brand_tokens` SET `name` = 'Teal', `note` = 'Medical and science accents' WHERE `id` = 'brand_core_10' AND `value` = '#0E9C95';
UPDATE `brand_tokens` SET `name` = 'Sky blue', `note` = 'Tech and info accents' WHERE `id` = 'brand_core_11' AND `value` = '#38BDF8';
UPDATE `brand_tokens` SET `note` = 'Success, done and approved', `groupName` = 'Core', `sortOrder` = -88 WHERE `kind` = 'color' AND `name` = 'Green' AND `value` = '#2EB872';
