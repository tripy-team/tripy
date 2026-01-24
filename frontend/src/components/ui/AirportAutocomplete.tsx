"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
};

// Convert API response to Airport format for compatibility
type Airport = {
  iata: string;
  city: string;
  country: string;
  airport: string;
  state?: string;
};

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

function formatLabel(a: AirportSuggestion) {
  const region = [a.city, a.region].filter(Boolean).join(", ");
  return `${a.iata_code} – ${region}, ${a.country}`;
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

type SuggestionLike = {
  name?: string;
  id?: string;
  description?: string;
  airports?: Array<{ id?: string; name?: string; city?: string }>;
};

function flattenSuggestionsToAirports(raw: SuggestionLike[]): AirportSuggestion[] {
  const out: AirportSuggestion[] = [];
  for (const s of raw) {
    const list = s.airports || [];
    const fallbackId =
      s.id && /^[A-Za-z]{3}$/.test(String(s.id).trim()) && list.length === 1
        ? String(s.id).trim().toUpperCase()
        : null;
    if (list.length === 0 && s.id && /^[A-Za-z]{3}$/.test(String(s.id).trim())) {
      const id = String(s.id).trim().toUpperCase();
      out.push({
        airport_id: id,
        iata_code: id,
        airport_name: s.name || id,
        city: s.name || "",
        country: s.description || "",
        region: "",
        display_name: `${id} – ${s.name || id}`,
      });
      continue;
    }
    for (const a of list) {
      let id = (a.id && String(a.id).trim()) || null;
      if (!id && fallbackId) id = fallbackId;
      if (!id) continue;
      id = id.toUpperCase();
      out.push({
        airport_id: id,
        iata_code: id,
        airport_name: a.name || id,
        city: a.city || s.name || "",
        country: s.description || "",
        region: "",
        display_name: `${id} – ${a.name || id}`,
      });
    }
  }
  return out;
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
  const [suggestions, setSuggestions] = useState<AirportSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  // Load recent airports (we'd need to store full airport data in localStorage to show
  // recent airports properly; for now always empty)
  const recentAirports = useMemo(() => [], []);

  // Group airports by city
  const groupedAirports = useMemo(() => {
    if (debounced.trim().length === 0) return { cities: {}, airports: recentAirports };
    
    const cities: Record<string, AirportSuggestion[]> = {};
    const airports: AirportSuggestion[] = [];
    
    for (const airport of suggestions) {
      const cityKey = `${airport.city}, ${airport.country}`.toLowerCase();
      if (!cities[cityKey]) {
        cities[cityKey] = [];
      }
      cities[cityKey].push(airport);
      airports.push(airport);
    }
    
    return { cities, airports };
  }, [debounced, suggestions, recentAirports]);

  // Display list: if empty query, show recents; else show suggestions
  const list: AirportSuggestion[] = useMemo(() => {
    if (debounced.trim().length === 0) return recentAirports;
    return suggestions;
  }, [debounced, recentAirports, suggestions]);

  const showRecents = debounced.trim().length === 0 && recentAirports.length > 0;
  
  // Check if we have multiple airports for the same city (city query)
  const hasCityGrouping = Object.keys(groupedAirports.cities).some(
    cityKey => groupedAirports.cities[cityKey].length > 1
  );

  function commitSelect(a: AirportSuggestion) {
    saveRecent(recentKey, a.iata_code);
    setRecent(loadRecent(recentKey));
    const formattedValue = a.iata_code; // Use IATA code as value
    onValueChange(formattedValue);
    if (onSelect) {
      onSelect(formattedValue);
    }
    setOpen(false);
  }
  
  function commitSelectCity(cityName: string, country: string, airports: AirportSuggestion[]) {
    // Select all airports for the city - use comma-separated IATA codes
    const iataCodes = airports.map(a => a.iata_code).join(",");
    const formattedValue = `${cityName} (${iataCodes})`;
    onValueChange(formattedValue);
    if (onSelect) {
      onSelect(formattedValue);
    }
    // Save all airports to recent
    airports.forEach(a => saveRecent(recentKey, a.iata_code));
    setRecent(loadRecent(recentKey));
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

    // Calculate total items (including city headers)
    let totalItems = list.length;
    if (hasCityGrouping) {
      totalItems = Object.values(groupedAirports.cities).reduce((sum, airports) => {
        return sum + airports.length + (airports.length > 1 ? 1 : 0); // +1 for city header if multiple
      }, 0);
    }
    
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Handle city selection or individual airport selection
      if (hasCityGrouping) {
        let currentIdx = 0;
        for (const [cityKey, cityAirports] of Object.entries(groupedAirports.cities)) {
          if (cityAirports.length > 1) {
            if (activeIdx === currentIdx) {
              commitSelectCity(cityAirports[0].city, cityAirports[0].country, cityAirports);
              return;
            }
            currentIdx++;
          }
          for (const airport of cityAirports) {
            if (activeIdx === currentIdx) {
              commitSelect(airport);
              return;
            }
            currentIdx++;
          }
        }
      } else {
        const pick = list[activeIdx];
        if (pick) commitSelect(pick);
      }
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
  }, [debounced, suggestions]);

  // Search via destinations.autocomplete (SerpAPI + fuzzy), flatten to AirportSuggestion[]
  useEffect(() => {
    const query = debounced.trim();

    if (!query || query.length < 1) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const timeoutId = setTimeout(async () => {
      try {
        const response = await destinations.autocomplete(query, 10, true);
        const raw = response?.suggestions ?? [];
        let airports = flattenSuggestionsToAirports(raw);
        if (airports.length === 0) {
          const fallbackRes = await destinations.fallbackDestinations(query, 10, true);
          airports = flattenSuggestionsToAirports(fallbackRes?.suggestions ?? []);
          setSuggestions(airports.length > 0 ? airports : filterFallbackAirports(query, 10));
        } else {
          setSuggestions(airports);
        }
      } catch (error) {
        console.error("Error fetching airport suggestions:", error);
        try {
          const fallbackRes = await destinations.fallbackDestinations(query, 10, true);
          const fallbackAirports = flattenSuggestionsToAirports(fallbackRes?.suggestions ?? []);
          setSuggestions(fallbackAirports.length > 0 ? fallbackAirports : filterFallbackAirports(query, 10));
        } catch {
          setSuggestions(filterFallbackAirports(query, 10));
        }
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => {
      clearTimeout(timeoutId);
      setIsLoading(false);
    };
  }, [debounced]);


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

      {open && (list.length > 0 || isLoading) && (
        <div 
          className="absolute mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
          style={{ zIndex: 10060 }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (inputRef.current && (inputRef.current as any)._blurTimeout) {
              clearTimeout((inputRef.current as any)._blurTimeout);
              (inputRef.current as any)._blurTimeout = null;
            }
          }}
        >
          {showRecents && (
            <div className="px-4 py-2 text-xs font-medium text-slate-500 border-b border-slate-100">
              Recent
            </div>
          )}

          {!showRecents && debounced.trim().length > 0 && (
            <div className="px-4 py-2 text-xs font-medium text-slate-500 border-b border-slate-100">
              {isLoading ? "Searching..." : "Suggestions"}
            </div>
          )}

          {isLoading ? (
            <div className="px-4 py-8 text-center">
              <div className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : hasCityGrouping ? (
            <ul className="max-h-80 overflow-auto">
              {Object.entries(groupedAirports.cities).map(([cityKey, cityAirports], cityIdx) => {
                const cityName = cityAirports[0]?.city || "";
                const country = cityAirports[0]?.country || "";
                const hasMultiple = cityAirports.length > 1;
                const cityItemIdx = cityIdx;
                const isCityActive = activeIdx === cityItemIdx;
                
                return (
                  <React.Fragment key={cityKey}>
                    {/* City header with "Select all" option */}
                    {hasMultiple && (
                      <li
                        onMouseEnter={() => setActiveIdx(cityItemIdx)}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (inputRef.current && (inputRef.current as any)._blurTimeout) {
                            clearTimeout((inputRef.current as any)._blurTimeout);
                            (inputRef.current as any)._blurTimeout = null;
                          }
                          commitSelectCity(cityName, country, cityAirports);
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (inputRef.current && (inputRef.current as any)._blurTimeout) {
                            clearTimeout((inputRef.current as any)._blurTimeout);
                            (inputRef.current as any)._blurTimeout = null;
                          }
                          commitSelectCity(cityName, country, cityAirports);
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          commitSelectCity(cityName, country, cityAirports);
                        }}
                        className={[
                          "flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors border-b border-slate-100",
                          isCityActive ? "bg-blue-50" : "bg-white hover:bg-slate-50",
                        ].join(" ")}
                      >
                        <div className="min-w-[44px] rounded-lg border border-blue-200 bg-blue-100 px-2 py-1 text-center text-xs font-semibold text-blue-900">
                          {cityAirports.length}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-blue-900">
                            {highlightMatch(cityName, debounced.trim())}, {country}
                          </div>
                          <div className="text-xs text-blue-600">
                            Select all {cityAirports.length} airports ({cityAirports.map(a => a.iata_code).join(", ")})
                          </div>
                        </div>
                      </li>
                    )}
                    {/* Individual airports for this city */}
                    {cityAirports.map((a, airportIdx) => {
                      const itemIdx = cityItemIdx + (hasMultiple ? 1 : 0) + airportIdx;
                      const active = activeIdx === itemIdx;
                      return (
                        <li
                          key={a.airport_id || `${a.iata_code}-${itemIdx}`}
                          onMouseEnter={() => setActiveIdx(itemIdx)}
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (inputRef.current && (inputRef.current as any)._blurTimeout) {
                              clearTimeout((inputRef.current as any)._blurTimeout);
                              (inputRef.current as any)._blurTimeout = null;
                            }
                            commitSelect(a);
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (inputRef.current && (inputRef.current as any)._blurTimeout) {
                              clearTimeout((inputRef.current as any)._blurTimeout);
                              (inputRef.current as any)._blurTimeout = null;
                            }
                            commitSelect(a);
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            commitSelect(a);
                          }}
                          className={[
                            "flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors",
                            active ? "bg-blue-50" : "bg-white hover:bg-slate-50",
                            hasMultiple ? "pl-12" : "",
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
                        </li>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </ul>
          ) : (
            <ul className="max-h-80 overflow-auto">
              {list.map((a, idx) => {
                const active = idx === activeIdx;
                return (
                  <li
                    key={a.airport_id || `${a.iata_code}-${idx}`}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (inputRef.current && (inputRef.current as any)._blurTimeout) {
                        clearTimeout((inputRef.current as any)._blurTimeout);
                        (inputRef.current as any)._blurTimeout = null;
                      }
                      commitSelect(a);
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (inputRef.current && (inputRef.current as any)._blurTimeout) {
                        clearTimeout((inputRef.current as any)._blurTimeout);
                        (inputRef.current as any)._blurTimeout = null;
                      }
                      commitSelect(a);
                    }}
                    onClick={(e) => {
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
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {open && debounced.trim().length > 0 && !isLoading && list.length === 0 && (
        <div 
          className="absolute mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-lg"
          style={{ zIndex: 10060 }}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          No matches. Try an airport code (e.g., SEA) or a city name.
        </div>
      )}
    </div>
  );
}
