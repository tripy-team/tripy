'use client';

/**
 * ErrorState Component
 * 
 * Structured error display with retry/go-back actions.
 */

import { AlertCircle, RefreshCw, ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  showBack?: boolean;
  retryLabel?: string;
}

export function ErrorState({ 
  title = 'Something went wrong',
  message,
  onRetry,
  showBack = true,
  retryLabel = 'Try Again'
}: ErrorStateProps) {
  const router = useRouter();
  
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
        <AlertCircle className="w-8 h-8 text-red-600" />
      </div>
      
      <h2 className="text-xl font-semibold text-slate-900 mb-2">{title}</h2>
      <p className="text-slate-500 text-center max-w-md mb-6">{message}</p>
      
      <div className="flex items-center gap-3">
        {showBack && (
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Go Back
          </button>
        )}
        
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export default ErrorState;
