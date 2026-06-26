'use client';

/**
 * Consumer (B2C) model: there is no "add a client" flow — the user only has
 * their own profile. Co-travelers are added as family members from inside the
 * profile. Redirect any lingering links here back to the user's own profile.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function NewClientRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/clients');
  }, [router]);

  return (
    <div className="flex items-center justify-center py-32 text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      Redirecting…
    </div>
  );
}
