'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Component that scrolls to top whenever the route changes
 * This ensures users always start at the top of a new page
 */
export function ScrollToTop() {
  const pathname = usePathname();

  useEffect(() => {
    // Scroll to top immediately when pathname changes
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'instant' as ScrollBehavior,
    });
    
    // Also set scroll position directly for immediate effect
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname]);

  return null;
}
