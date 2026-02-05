"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { X, Plus } from "lucide-react";
import { destinations } from "@/lib/api";
import { filterFallbackAirports } from "@/lib/autocomplete-fallback-data";

// Airport type matching API response
type AirportSuggestion = {
  airport_id: string;
  iata_code: string;
  airport_name: string;
  city: string;
  country: string;
  region?: string;
  display_name: string;
  uniqueKey: string;
};

// Selected airport with display info
type SelectedAirport = {
  code: string;
  city: string;
  name: string;
};

// Client-side response cache
const airportCache = new Map<string, { data: AirportSuggestion[]; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCachedAirports(query: string): AirportSuggestion[] | null {
  const cached = airportCache.get(query.toLowerCase());
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  return null;
}

function setCachedAirports(query: string, data: AirportSuggestion[]) {
  if (airportCache.size > 100) {
    const oldestKey = airportCache.keys().next().value;
    if (oldestKey) airportCache.delete(oldestKey);
  }
  airportCache.set(query.toLowerCase(), { data, timestamp: Date.now() });
}

type SuggestionLike = {
  name?: string;
  id?: string;
  description?: string;
  airports?: Array<{ id?: string; name?: string; city?: string }>;
};

function flattenSuggestionsToAirports(raw: SuggestionLike[]): AirportSuggestion[] {
  const out: AirportSuggestion[] = [];
  const seen = new Set<string>();
  
  for (const s of raw) {
    const list = s.airports || [];
    const fallbackId =
      s.id && /^[A-Za-z]{3}$/.test(String(s.id).trim()) && list.length === 1
        ? String(s.id).trim().toUpperCase()
        : null;
    if (list.length === 0 && s.id && /^[A-Za-z]{3}$/.test(String(s.id).trim())) {
      const id = String(s.id).trim().toUpperCase();
      const city = s.name || "";
      const uniqueKey = `${id}-${city}`.toLowerCase();
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      out.push({
        airport_id: id,
        iata_code: id,
        airport_name: s.name || id,
        city,
        country: s.description || "",
        region: "",
        display_name: `${id} – ${s.name || id}`,
        uniqueKey,
      });
      continue;
    }
    for (const a of list) {
      let id = (a.id && String(a.id).trim()) || null;
      if (!id && fallbackId) id = fallbackId;
      if (!id) continue;
      id = id.toUpperCase();
      const city = a.city || s.name || "";
      const uniqueKey = `${id}-${city}`.toLowerCase();
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      out.push({
        airport_id: id,
        iata_code: id,
        airport_name: a.name || id,
        city,
        country: s.description || "",
        region: "",
        display_name: `${id} – ${a.name || id}`,
        uniqueKey,
      });
    }
  }
  return out;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!text || !query) return text;
  
  const lowerText = text.toLowerCase();
  const queryLower = query.toLowerCase();
  const matchIndex = lowerText.indexOf(queryLower);
  
  if (matchIndex === -1) {
    return text;
  }
  
  const before = text.substring(0, matchIndex);
  const match = text.substring(matchIndex, matchIndex + query.length);
  const after = text.substring(matchIndex + query.length);
  
  return (
    <>
      {before}
      <span className="font-semibold bg-blue-100 text-blue-900">{match}</span>
      {after}
    </>
  );
}

type Props = {
  // Array of IATA codes
  value: string[];
  onChange: (airports: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  maxSelections?: number;
  label?: string;
};

export default function MultiAirportAutocomplete({
  value = [],
  onChange,
  placeholder = "Search airports...",
  disabled = false,
  className = "",
  maxSelections = 5,
  label,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [suggestions, setSuggestions] = useState<AirportSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDetails, setSelectedDetails] = useState<Map<string, SelectedAirport>>(new Map());
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Debounced query
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Close on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Filter out already selected airports
  const filteredSuggestions = useMemo(() => {
    return suggestions.filter(s => !value.includes(s.iata_code));
  }, [suggestions, value]);

  // Search airports
  useEffect(() => {
    const q = debounced.trim();

    if (!q || q.length < 1) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    const cached = getCachedAirports(q);
    if (cached) {
      setSuggestions(cached);
      setIsLoading(false);
      return;
    }

    const instantFallback = filterFallbackAirports(q, 10);
    if (instantFallback.length > 0) {
      setSuggestions(instantFallback);
    }
    
    setIsLoading(true);
    
    const controller = new AbortController();
    
    (async () => {
      try {
        const response = await fetch(
          `/api/airports/autocomplete?q=${encodeURIComponent(q)}&limit=10`,
          {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
          }
        );
        
        if (!response.ok) throw new Error('Failed to fetch airports');
        
        const data = await response.json();
        const airports = data?.airports ?? [];
        
        if (airports.length > 0) {
          setSuggestions(airports);
          setCachedAirports(q, airports);
        } else if (instantFallback.length === 0) {
          const fallbackResponse = await destinations.autocomplete(q, 10, true);
          const raw = fallbackResponse?.suggestions ?? [];
          let fallbackAirports = flattenSuggestionsToAirports(raw);
          
          if (fallbackAirports.length === 0) {
            const fallbackRes = await destinations.fallbackDestinations(q, 10, true);
            fallbackAirports = flattenSuggestionsToAirports(fallbackRes?.suggestions ?? []);
          }
          
          const finalResults = fallbackAirports.length > 0 ? fallbackAirports : filterFallbackAirports(q, 10);
          setSuggestions(finalResults);
          if (finalResults.length > 0) {
            setCachedAirports(q, finalResults);
          }
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        console.error("Error fetching airport suggestions:", error);
        if (instantFallback.length === 0) {
          setSuggestions(filterFallbackAirports(q, 10));
        }
      } finally {
        setIsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [debounced]);

  // Reset active index on list change
  useEffect(() => {
    setActiveIdx(0);
  }, [filteredSuggestions]);

  // Add airport to selection
  const addAirport = useCallback((airport: AirportSuggestion) => {
    if (value.length >= maxSelections) return;
    if (value.includes(airport.iata_code)) return;
    
    // Store details for display
    setSelectedDetails(prev => {
      const next = new Map(prev);
      next.set(airport.iata_code, {
        code: airport.iata_code,
        city: airport.city,
        name: airport.airport_name,
      });
      return next;
    });
    
    onChange([...value, airport.iata_code]);
    setQuery("");
    setOpen(false);
  }, [value, onChange, maxSelections]);

  // Remove airport from selection
  const removeAirport = useCallback((code: string) => {
    onChange(value.filter(c => c !== code));
  }, [value, onChange]);

  // Keyboard navigation
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, filteredSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = filteredSuggestions[activeIdx];
      if (pick) addAirport(pick);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Backspace" && query === "" && value.length > 0) {
      // Remove last selected airport when backspacing on empty input
      removeAirport(value[value.length - 1]);
    }
  };

  const canAddMore = value.length < maxSelections;

  return (
    <div ref={wrapperRef} className={`relative w-full ${className}`}>
      {label && (
        <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
          {label}
        </label>
      )}
      
      {/* Selected airports as tags + input */}
      <div 
        className={`flex flex-wrap items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-blue-600 focus-within:border-transparent min-h-[46px] ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        onClick={() => {
          if (!disabled) inputRef.current?.focus();
        }}
      >
        {/* Selected airport tags */}
        {value.map(code => {
          const details = selectedDetails.get(code);
          return (
            <span
              key={code}
              className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-lg text-sm font-medium"
            >
              <span className="font-bold">{code}</span>
              {details && <span className="text-blue-600 text-xs">({details.city})</span>}
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAirport(code);
                  }}
                  className="ml-1 hover:bg-blue-200 rounded p-0.5 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          );
        })}
        
        {/* Input for adding more */}
        {canAddMore && (
          <input
            ref={inputRef}
            value={query}
            placeholder={value.length === 0 ? placeholder : "Add another..."}
            disabled={disabled}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
            className="flex-1 min-w-[120px] py-1 bg-transparent outline-none text-sm placeholder:text-slate-400"
          />
        )}
        
        {!canAddMore && value.length > 0 && (
          <span className="text-xs text-slate-400">Max {maxSelections} airports</span>
        )}
      </div>

      {/* Dropdown */}
      {open && canAddMore && (filteredSuggestions.length > 0 || isLoading) && (
        <div 
          className="absolute mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
          style={{ zIndex: 10060 }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <div className="px-4 py-2 text-xs font-medium text-slate-500 border-b border-slate-100">
            {isLoading ? "Searching..." : "Select airports"}
          </div>

          {isLoading ? (
            <div className="px-4 py-8 text-center">
              <div className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <ul className="max-h-60 overflow-auto">
              {filteredSuggestions.map((a, idx) => {
                const active = idx === activeIdx;
                return (
                  <li
                    key={a.uniqueKey || `${a.iata_code}-${idx}`}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      addAirport(a);
                    }}
                    className={[
                      "flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors",
                      active ? "bg-blue-50" : "bg-white hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <div className="min-w-[44px] rounded-lg border border-slate-200 bg-blue-50 px-2 py-1 text-center text-xs font-semibold text-blue-900">
                      {a.iata_code.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900">
                        {highlightMatch(a.city, debounced.trim())}
                        {a.region ? `, ${a.region}` : ""} • {a.country}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {highlightMatch(a.airport_name, debounced.trim())}
                      </div>
                    </div>
                    <Plus className="w-4 h-4 text-blue-600" />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {open && canAddMore && debounced.trim().length > 0 && !isLoading && filteredSuggestions.length === 0 && (
        <div 
          className="absolute mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-lg"
          style={{ zIndex: 10060 }}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          No matches found. Try an airport code (e.g., SEA) or city name.
        </div>
      )}

      {value.length > 1 && (
        <p className="text-xs text-slate-500 mt-2">
          We&apos;ll search flights from all {value.length} airports to find the best deals.
        </p>
      )}
    </div>
  );
}
