'use client';

import { Plane, Map } from 'lucide-react';
import Link from 'next/link';

interface TripyLogoProps {
  className?: string;
  iconClassName?: string;
  showText?: boolean;
  href?: string;
}

export function TripyLogo({ 
  className = "", 
  iconClassName = "w-5 h-5", 
  showText = true,
  href = "/"
}: TripyLogoProps) {
  const logoContent = (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="relative group">
        <div className="absolute inset-0 bg-blue-600 rounded-xl blur opacity-25 group-hover:opacity-40 transition-opacity"></div>
        <div className="relative w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20 group-hover:scale-105 transition-transform duration-200 overflow-hidden">
          {/* Layered icons for complexity */}
          <div className="relative z-10 flex items-center justify-center">
            <Plane className={`${iconClassName} text-white -rotate-45 group-hover:-rotate-12 transition-transform duration-300 relative z-20`} fill="currentColor" />
          </div>
        </div>
      </div>
      {showText && (
        <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700">
          TripsHacker
        </span>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="inline-block">
        {logoContent}
      </Link>
    );
  }

  return logoContent;
}
