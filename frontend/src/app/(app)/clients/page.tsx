'use client';

/**
 * Consumer (B2C) model: there is no client roster. This route resolves the
 * signed-in user's own traveler profile and redirects to it.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getMyClient } from '@/lib/api-client';

export default function ClientsPage() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    getMyClient()
      .then((c) => {
        if (active) router.replace(`/clients/${c.id}`);
      })
      .catch(() => {
        if (active) router.replace('/plan');
      });
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <div className="flex items-center justify-center py-32 text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      Loading your profile…
    </div>
  );
}
