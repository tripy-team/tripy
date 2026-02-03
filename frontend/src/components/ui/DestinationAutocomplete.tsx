'use client';

import { Fragment, useState, useEffect, useRef, useMemo } from 'react';
import { Plane } from 'lucide-react';
import { destinations } from '@/lib/api';
import { filterFallbackAirports } from '@/lib/autocomplete-fallback-data';

// Match AirportAutocomplete: flatten to airport-level and support city grouping + select all
type AirportSuggestion = {
  airport_id: string;
  iata_code: string;
  airport_name: string;
  city: string;
  country: string;
  region?: string;
  display_name: string;
};

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
        city: s.name || '',
        country: s.description || '',
        region: '',
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
        city: a.city || s.name || '',
        country: s.description || '',
        region: '',
        display_name: `${id} – ${a.name || id}`,
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
  if (matchIndex === -1) return text;
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

interface DestinationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
  onSelect?: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
}

export function DestinationAutocomplete({
  value,
  onChange,
  placeholder = 'Add a city...',
  label: _label,
  disabled = false,
  className = '',
  onSelect,
  onKeyDown,
  autoFocus = false,
}: DestinationAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [suggestions, setSuggestions] = useState<AirportSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedAirports, setSelectedAirports] = useState<{ id: string; name?: string }[]>([]);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Clear selection when value is cleared
  useEffect(() => {
    if (!value || !value.trim()) {
      setSelectedCity(null);
      setSelectedAirports([]);
    }
  }, [value]);

  // Close on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 80);
    return () => clearTimeout(t);
  }, [value]);

  // Group airports by city (like AirportAutocomplete / routes selector)
  const groupedAirports = useMemo(() => {
    if (debounced.trim().length === 0) return { cities: {} as Record<string, AirportSuggestion[]>, airports: [] };
    const cities: Record<string, AirportSuggestion[]> = {};
    const airports: AirportSuggestion[] = [];
    for (const a of suggestions) {
      const cityKey = `${a.city}, ${a.country}`.toLowerCase();
      if (!cities[cityKey]) cities[cityKey] = [];
      cities[cityKey].push(a);
      airports.push(a);
    }
    return { cities, airports };
  }, [debounced, suggestions]);

  const list = suggestions;
  const hasCityGrouping = Object.keys(groupedAirports.cities).some(
    (k) => groupedAirports.cities[k].length > 1
  );

  // Destination uses "City (IATA)" or "City (IATA1,IATA2)" to always include city
  function commitSelect(a: AirportSuggestion) {
    const formattedValue = a.city ? `${a.city} (${a.iata_code})` : a.iata_code;
    setSelectedCity(a.city || null);
    setSelectedAirports([{ id: a.iata_code, name: a.airport_name }]);
    onChange(formattedValue);
    if (onSelect) onSelect(formattedValue);
    setOpen(false);
  }

  function commitSelectCity(cityName: string, _country: string, cityAirports: AirportSuggestion[]) {
    const iataCodes = cityAirports.map((a) => a.iata_code).join(',');
    const formattedValue = `${cityName} (${iataCodes})`;
    setSelectedCity(cityName);
    setSelectedAirports(cityAirports.map((a) => ({ id: a.iata_code, name: a.airport_name })));
    onChange(formattedValue);
    if (onSelect) onSelect(formattedValue);
    setOpen(false);
  }

  function onKeyDownInternal(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (!open) {
      if (onKeyDown) onKeyDown(e);
      return;
    }
    let totalItems = list.length;
    if (hasCityGrouping) {
      totalItems = Object.values(groupedAirports.cities).reduce(
        (sum, arr) => sum + arr.length + (arr.length > 1 ? 1 : 0),
        0
      );
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, totalItems - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (hasCityGrouping) {
        let idx = 0;
        for (const [, arr] of Object.entries(groupedAirports.cities)) {
          if (arr.length > 1) {
            if (activeIdx === idx) {
              commitSelectCity(arr[0].city, arr[0].country, arr);
              return;
            }
            idx++;
          }
          for (const a of arr) {
            if (activeIdx === idx) {
              commitSelect(a);
              return;
            }
            idx++;
          }
        }
      } else {
        const pick = list[activeIdx];
        if (pick) commitSelect(pick);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (onKeyDown) {
      onKeyDown(e);
    }
  }

  useEffect(() => {
    setActiveIdx(0);
  }, [debounced, suggestions]);

  // Fetch: same as AirportAutocomplete, with commercialOnly=true
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
        const response = await destinations.autocomplete(query, 12, true);
        const raw = response?.suggestions ?? [];
        let airports = flattenSuggestionsToAirports(raw);
        if (airports.length === 0) {
          const fallbackRes = await destinations.fallbackDestinations(query, 12, true);
          airports = flattenSuggestionsToAirports(fallbackRes?.suggestions ?? []);
        }
        if (airports.length === 0) {
          airports = filterFallbackAirports(query, 12).map((a) => ({
            airport_id: a.iata_code,
            iata_code: a.iata_code,
            airport_name: a.airport_name,
            city: a.city,
            country: a.country,
            region: '',
            display_name: `${a.iata_code} – ${a.airport_name}`,
          }));
        }
        setSuggestions(airports);
      } catch (err) {
        console.error('[DestinationAutocomplete] Error fetching:', err);
        try {
          const fallbackRes = await destinations.fallbackDestinations(query, 12, true);
          const airports = flattenSuggestionsToAirports(fallbackRes?.suggestions ?? []);
          setSuggestions(airports.length > 0 ? airports : filterFallbackAirports(query, 12).map((a) => ({
            airport_id: a.iata_code,
            iata_code: a.iata_code,
            airport_name: a.airport_name,
            city: a.city,
            country: a.country,
            region: '',
            display_name: `${a.iata_code} – ${a.airport_name}`,
          })));
        } catch {
          setSuggestions(filterFallbackAirports(query, 12).map((a) => ({
            airport_id: a.iata_code,
            iata_code: a.iata_code,
            airport_name: a.airport_name,
            city: a.city,
            country: a.country,
            region: '',
            display_name: `${a.iata_code} – ${a.airport_name}`,
          })));
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
    <div ref={wrapperRef} className={`relative w-full ${className}`} style={{ position: 'relative', zIndex: open ? 9999 : 1 }}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDownInternal}
          onBlur={(e) => {
            const relatedTarget = e.relatedTarget as Node;
            if (wrapperRef.current?.contains(relatedTarget)) return;
            const t = setTimeout(() => {
              if (!wrapperRef.current?.contains(document.activeElement)) setOpen(false);
            }, 200);
            if (inputRef.current) (inputRef.current as any)._blurTimeout = t;
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {isLoading && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

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
          <div className="px-4 py-2 text-xs font-medium text-slate-500 border-b border-slate-100">
            {isLoading ? 'Searching...' : 'Suggestions'}
          </div>
          {isLoading ? (
            <div className="px-4 py-8 text-center">
              <div className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : hasCityGrouping ? (
            <ul className="max-h-80 overflow-auto">
              {Object.entries(groupedAirports.cities).map(([cityKey, cityAirports], cityIdx) => {
                const cityName = cityAirports[0]?.city || '';
                const country = cityAirports[0]?.country || '';
                const hasMultiple = cityAirports.length > 1;
                const cityItemIdx = cityIdx;
                return (
                  <Fragment key={cityKey}>
                    {hasMultiple && (
                      <li
                        onMouseEnter={() => setActiveIdx(cityItemIdx)}
                        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); commitSelectCity(cityName, country, cityAirports); }}
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); commitSelectCity(cityName, country, cityAirports); }}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); commitSelectCity(cityName, country, cityAirports); }}
                        className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors border-b border-slate-100 ${activeIdx === cityItemIdx ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'}`}
                      >
                        <div className="min-w-[44px] rounded-lg border border-blue-200 bg-blue-100 px-2 py-1 text-center text-xs font-semibold text-blue-900">
                          {cityAirports.length}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-blue-900">
                            {highlightMatch(cityName, debounced.trim())}, {country}
                          </div>
                          <div className="text-xs text-blue-600">
                            Select all {cityAirports.length} airports ({cityAirports.map((a) => a.iata_code).join(', ')})
                          </div>
                        </div>
                      </li>
                    )}
                    {cityAirports.map((a, airportIdx) => {
                      const itemIdx = cityItemIdx + (hasMultiple ? 1 : 0) + airportIdx;
                      const active = activeIdx === itemIdx;
                      return (
                        <li
                          key={a.airport_id || `${a.iata_code}-${itemIdx}`}
                          onMouseEnter={() => setActiveIdx(itemIdx)}
                          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); commitSelect(a); }}
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); commitSelect(a); }}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); commitSelect(a); }}
                          className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors ${active ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'} ${hasMultiple ? 'pl-12' : ''}`}
                        >
                          <div className="min-w-[44px] rounded-lg border border-slate-200 bg-blue-50 px-2 py-1 text-center text-xs font-semibold text-blue-900">
                            {a.iata_code.toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-slate-900">
                              {highlightMatch(a.city, debounced.trim())}
                              {a.region ? `, ${a.region}` : ''} • {a.country}
                            </div>
                            <div className="text-xs text-slate-500 truncate">{highlightMatch(a.airport_name, debounced.trim())}</div>
                          </div>
                        </li>
                      );
                    })}
                  </Fragment>
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
                    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); commitSelect(a); }}
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); commitSelect(a); }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); commitSelect(a); }}
                    className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors ${active ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'}`}
                  >
                    <div className="min-w-[44px] rounded-lg border border-slate-200 bg-blue-50 px-2 py-1 text-center text-xs font-semibold text-blue-900">
                      {a.iata_code.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900">
                        {highlightMatch(a.city, debounced.trim())}
                        {a.region ? `, ${a.region}` : ''} • {a.country}
                      </div>
                      <div className="text-xs text-slate-500 truncate">{highlightMatch(a.airport_name, debounced.trim())}</div>
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
          No matches. Try a city name or airport code (e.g. Paris, CDG).
        </div>
      )}

      {selectedCity && selectedAirports.length > 0 && !open && (
        <div className="mt-3 flex flex-wrap gap-2">
          {selectedAirports.map((ap) => (
            <span
              key={ap.id}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium border border-blue-100"
            >
              <Plane className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="font-semibold">{ap.id}</span>
              {ap.name && ap.name !== ap.id && <span className="text-blue-600 truncate max-w-[120px]">{ap.name}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
