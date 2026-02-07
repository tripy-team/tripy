'use client';

import Link from 'next/link';
import { Info, ArrowRight, CreditCard } from 'lucide-react';

interface TransferInfoBannerProps {
    /** 'full' shows a larger card-style banner; 'compact' shows a subtle inline link. Default: 'full' */
    variant?: 'full' | 'compact';
}

/**
 * A banner / indicator that links to /learn/point-transfers explaining
 * how point transfers work, why they beat portal bookings,
 * and which cards allow direct airline transfers.
 */
export default function TransferInfoBanner({ variant = 'full' }: TransferInfoBannerProps) {
    if (variant === 'compact') {
        return (
            <Link
                href="/learn/point-transfers"
                className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 transition-colors group"
            >
                <Info className="w-3.5 h-3.5" />
                <span className="underline underline-offset-2 decoration-blue-300 group-hover:decoration-blue-600">
                    Why transfer points? Learn how it works
                </span>
                <ArrowRight className="w-3 h-3 opacity-0 -ml-1 group-hover:opacity-100 group-hover:ml-0 transition-all" />
            </Link>
        );
    }

    return (
        <Link href="/learn/point-transfers" className="block group">
            <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl flex items-start gap-3 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer">
                <div className="p-1.5 bg-blue-100 rounded-lg flex-shrink-0 mt-0.5">
                    <CreditCard className="w-4 h-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-slate-900">Why transfer points instead of using the travel portal?</span>
                        <ArrowRight className="w-3.5 h-3.5 text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                        Transferring points to airline partners often yields <strong>2&ndash;4x more value</strong> than booking through your bank&apos;s portal.
                        Not all cards support direct transfers &mdash; learn which ones do and how the process works.
                    </p>
                </div>
            </div>
        </Link>
    );
}
