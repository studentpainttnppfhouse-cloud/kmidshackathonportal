/** Shared between the S3 and local drivers, and free of either's imports. */

export interface StorageError {
  message: string;
}

/** Mirrors the fields the export manifest recorded from Supabase Storage. */
export interface StoredObject {
  name: string;
  size: number | null;
  updated_at: string | null;
}
