'use client';

import { useEffect } from 'react';
import { ensureDevSession } from '@/lib/dev-auth';

/**
 * Seeds a fake local session on app startup when NEXT_PUBLIC_DEV_AUTH_BYPASS is
 * set, so the site is browsable locally without signing in. Renders nothing and
 * is a no-op in any build where the flag is unset (i.e. everywhere but dev).
 */
export function DevAutoLogin() {
  useEffect(() => {
    ensureDevSession();
  }, []);

  return null;
}
