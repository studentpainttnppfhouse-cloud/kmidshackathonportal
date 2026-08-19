import { KitClient } from '@/features/kit/kit-client';

export const dynamic = 'force-static';

/**
 * States & Component Kit — the reference screen from the design export.
 * It exists so a future maintainer can see every shared state and control in
 * one place instead of hunting for a screen that happens to be loading.
 */
export default function KitPage() {
  return <KitClient />;
}
