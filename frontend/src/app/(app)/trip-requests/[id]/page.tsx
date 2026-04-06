'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

export default function TripRequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const tripId = params.id as string;

  useEffect(() => {
    router.replace(`/trips/${tripId}`);
  }, [router, tripId]);

  return (
    <div className="flex items-center justify-center py-32">
      <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
      <span className="ml-3 text-slate-500">Redirecting...</span>
    </div>
  );
}
