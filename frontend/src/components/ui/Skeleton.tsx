import { cn } from './utils';

/**
 * Content-shaped placeholder shown while data/JS is still loading.
 * A skeleton reads as "content is coming" and avoids layout shift, so it feels
 * faster than a bare spinner during the cold first-load (HTML stream → JS
 * download → hydration gap), where it renders server-side with no JS required.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-gray-200', className)}
      {...props}
    />
  );
}
