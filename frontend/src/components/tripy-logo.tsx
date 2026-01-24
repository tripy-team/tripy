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
        <div className="relative w-10 h-10 bg-gradient-to-br from-blue-600 via-indigo-600 to-indigo-700 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20 group-hover:scale-105 transition-transform duration-200 overflow-hidden">
          {/* Background decoration */}
          <div className="absolute top-0 right-0 w-6 h-6 bg-white/10 rounded-bl-2xl"></div>
          <div className="absolute bottom-0 left-0 w-4 h-4 bg-white/10 rounded-tr-xl"></div>
          
          {/* Layered icons for complexity */}
          <div className="relative z-10 flex items-center justify-center">
            <Map className="absolute w-6 h-6 text-white/20" />
            <Plane className={`${iconClassName} text-white -rotate-45 group-hover:-rotate-12 transition-transform duration-300 relative z-20`} fill="currentColor" />
          </div>
        </div>
      </div>
      {showText && (
        <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700">
          Tripy
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
