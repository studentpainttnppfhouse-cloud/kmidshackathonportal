/**
 * Kept out of actions.ts because a 'use server' module may only export async
 * functions — a plain constant there is a build error.
 */

/** 50 MB per file (§5.9). Anything bigger is stored as an external link. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
