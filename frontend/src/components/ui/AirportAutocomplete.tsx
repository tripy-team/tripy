"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Airport } from "@/lib/locationSearch";
import { searchAirports, highlightMatch } from "@/lib/locationSearch";

// Cache for loaded data
let airportsCache: Airport[] | null = null;
let metroMappingsCache: Record<string, string[]> | null = null;

// Load airports data dynamically
async function loadAirportsData(): Promise<{
  airports: Airport[];
  metroMappings: Record<string, string[]>;
}> {
  if (airportsCache && metroMappingsCache) {
    return {
      airports: airportsCache,
      metroMappings: metroMappingsCache,
    };
  }

  // Fetch from public directory - works reliably in client components
  // No webpack path resolution issues, works in dev + prod + Amplify
  const res = await fetch("/data/airports.json", {
    cache: "force-cache",
  });

  if (!res.ok) {
    throw new Error(`Failed to load airports.json: ${res.status}`);
  }

  const json = (await res.json()) as {
    airports: Airport[];
    metro_mappings: Record<string, string[]>;
  };

  airportsCache = json.airports;
  metroMappingsCache = json.metro_mappings;
  
  return {
    airports: airportsCache,
    metroMappings: metroMappingsCache,
  };
}

type Props = {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onSelect?: (value: string) => void;
  onKeyDownHandler?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  recentKey?: string; // localStorage key
};

type RecentItem = { iata: string; ts: number };

function formatLabel(a: Airport) {
  const region = [a.city, a.state].filter(Boolean).join(", ");
  return `${a.iata} – ${region}, ${a.country}`;
}

function saveRecent(key: string, iata: string) {
  try {
    const raw = localStorage.getItem(key);
    const prev: RecentItem[] = raw ? JSON.parse(raw) : [];
    const next = [
      { iata, ts: Date.now() },
      ...prev.filter((x) => x.iata !== iata),
    ].slice(0, 6);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {}
}

function loadRecent(key: string): RecentItem[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as RecentItem[]) : [];
  } catch {
    return [];
  }
}

export default function AirportAutocomplete({
  value,
  onValueChange,
  placeholder = "City or airport",
  disabled = false,
  className = "",
  onSelect,
  onKeyDownHandler,
  autoFocus = false,
  recentKey = "recent_airports",
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [airports, setAirports] = useState<Airport[]>([]);
  const [metroMappings, setMetroMappings] = useState<Record<string, string[]>>({});
  const [isLoadingData, setIsLoadingData] = useState(true);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Load airports data on mount
  useEffect(() => {
    // Set a timeout to ensure we don't stay disabled forever if loading fails
    const timeoutId = setTimeout(() => {
      setIsLoadingData(false);
    }, 5000); // 5 second timeout

    loadAirportsData()
      .then(({ airports: loadedAirports, metroMappings: loadedMappings }) => {
        setAirports(loadedAirports);
        setMetroMappings(loadedMappings);
        setIsLoadingData(false);
        clearTimeout(timeoutId);
      })
      .catch((error) => {
        console.error('Error loading airports data:', error);
        // Even if loading fails, enable the input so users can still type
        setIsLoadingData(false);
        clearTimeout(timeoutId);
      });

    return () => clearTimeout(timeoutId);
  }, []);

  // load recent once
  useEffect(() => {
    setRecent(loadRecent(recentKey));
  }, [recentKey]);

  // close on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // debounced query for smoother typing
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 80);
    return () => clearTimeout(t);
  }, [value]);

  const recentAirports = useMemo(() => {
    if (airports.length === 0) return [];
    const map = new Map(airports.map((a) => [a.iata.toUpperCase(), a]));
    return recent
      .map((r) => map.get(r.iata.toUpperCase()))
      .filter(Boolean) as Airport[];
  }, [recent, airports]);

  const results = useMemo(() => {
    if (airports.length === 0) return [];
    const q = debounced.trim();
    if (!q) return [];
    return searchAirports(airports, q, 10, metroMappings);
  }, [debounced, airports, metroMappings]);

  // display list: if empty query, show recents; else show results
  const list: Airport[] = useMemo(() => {
    if (debounced.trim().length === 0) return recentAirports;
    return results;
  }, [debounced, recentAirports, results]);

  const showRecents = debounced.trim().length === 0 && recentAirports.length > 0;

  function commitSelect(a: Airport) {
    saveRecent(recentKey, a.iata);
    setRecent(loadRecent(recentKey));
    const formattedValue = a.iata; // Use IATA code as value
    onValueChange(formattedValue);
    if (onSelect) {
      onSelect(formattedValue);
    }
    setOpen(false);
  }

  function onKeyDownInternal(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) {
      if (onKeyDownHandler) onKeyDownHandler(e);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, list.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = list[activeIdx];
      if (pick) commitSelect(pick);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (onKeyDownHandler) {
      onKeyDownHandler(e);
    }
  }

  useEffect(() => {
    // reset highlighted item on list changes
    setActiveIdx(0);
  }, [debounced]);

  // Check if query matches a metro code
  const isMetroCode = useMemo(() => {
    const q = debounced.trim().toUpperCase();
    return q in metroMappings;
  }, [debounced, metroMappings]);

  // Show loading state while data loads, but allow input to work
  // Only disable if explicitly disabled via prop
  if (isLoadingData && airports.length === 0 && !disabled) {
    // Show a loading indicator but keep input enabled
    return (
      <div className={`relative w-full ${className}`} style={{ position: 'relative', zIndex: 1 }}>
        <input
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => {
            onValueChange(e.target.value);
          }}
          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        />
        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
          <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className={`relative w-full ${className}`} style={{ position: 'relative', zIndex: 1 }}>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onValueChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDownInternal}
        onBlur={(e) => {
          // Don't hide if clicking inside the dropdown
          const relatedTarget = e.relatedTarget as Node;
          if (wrapperRef.current?.contains(relatedTarget)) {
            return;
          }
          // Use setTimeout to allow onClick on suggestions to fire first
          // Increased timeout to ensure clicks register properly
          const timeoutId = setTimeout(() => {
            // Double-check that we're not clicking inside before closing
            if (!wrapperRef.current?.contains(document.activeElement)) {
              setOpen(false);
            }
          }, 200);
          // Store timeout so we can clear it if needed
          if (inputRef.current) {
            (inputRef.current as any)._blurTimeout = timeoutId;
          }
        }}
        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed text-sm"
      />

      {open && list.length > 0 && (
        <div 
          className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
          onMouseDown={(e) => {
            // Prevent input blur when clicking in dropdown
            e.preventDefault();
            e.stopPropagation();
            // Clear any pending blur timeout
            if (inputRef.current && (inputRef.current as any)._blurTimeout) {
              clearTimeout((inputRef.current as any)._blurTimeout);
              (inputRef.current as any)._blurTimeout = null;
            }
          }}
          onClick={(e) => {
            // Prevent any click propagation issues
            e.stopPropagation();
          }}
        >
          {showRecents && (
            <div className="px-4 py-2 text-xs font-medium text-slate-500 border-b border-slate-100">
              Recent
            </div>
          )}

          {!showRecents && debounced.trim().length > 0 && (
            <div className="px-4 py-2 text-xs font-medium text-slate-500 border-b border-slate-100">
              {isMetroCode ? "Metro Area" : "Suggestions"}
            </div>
          )}

          <ul className="max-h-80 overflow-auto">
            {list.map((a, idx) => {
              const active = idx === activeIdx;
              return (
                <li
                  key={`${a.iata}-${a.airport}`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onPointerDown={(e) => {
                    // Use pointer events for better touch/mouse support
                    e.preventDefault();
                    e.stopPropagation();
                    // Clear blur timeout
                    if (inputRef.current && (inputRef.current as any)._blurTimeout) {
                      clearTimeout((inputRef.current as any)._blurTimeout);
                      (inputRef.current as any)._blurTimeout = null;
                    }
                    commitSelect(a);
                  }}
                  onMouseDown={(e) => {
                    // prevent blur before click
                    e.preventDefault();
                    e.stopPropagation();
                    // Clear blur timeout
                    if (inputRef.current && (inputRef.current as any)._blurTimeout) {
                      clearTimeout((inputRef.current as any)._blurTimeout);
                      (inputRef.current as any)._blurTimeout = null;
                    }
                    commitSelect(a);
                  }}
                  onClick={(e) => {
                    // Ensure click works as backup
                    e.preventDefault();
                    e.stopPropagation();
                    commitSelect(a);
                  }}
                  className={[
                    "flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors",
                    active ? "bg-blue-50" : "bg-white hover:bg-slate-50",
                  ].join(" ")}
                >
                  <div className="min-w-[44px] rounded-lg border border-slate-200 bg-blue-50 px-2 py-1 text-center text-xs font-semibold text-blue-900">
                    {a.iata.toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900">
                      {highlightMatch(a.city, debounced.trim())}
                      {a.state ? `, ${a.state}` : ""} • {a.country}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {highlightMatch(a.airport, debounced.trim())}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {open && debounced.trim().length > 0 && list.length === 0 && (
        <div className="absolute z-50 mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-lg">
          No matches. Try an airport code (e.g., "SEA") or a city name.{" "}
          {debounced.trim().length === 3 && (
            <span className="text-slate-400">
              Did you mean a metro code like NYC, LON, or PAR?
            </span>
          )}
        </div>
      )}
    </div>
  );
}
