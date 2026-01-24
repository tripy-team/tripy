'use client';

import { useState, useEffect, useRef } from 'react';
import { Plane, Bus, Car } from 'lucide-react';
import { destinations, type CitySuggestion } from '@/lib/api';
import { filterFallbackCities } from '@/lib/autocomplete-fallback-data';

interface DestinationAutocompleteProps {
  // The current text value of the input (controlled component)
  value: string;
  
  // Callback when the input value changes or a destination is selected
  onChange: (value: string) => void;
  
  // Optional placeholder text
  placeholder?: string;
  
  // Optional label (though typically handled by external UI)
  label?: string;
  
  // Disables the input
  disabled?: boolean;
  
  // Additional CSS classes
  className?: string;
  
  // Optional callback specifically when a user clicks a suggestion
  onSelect?: (value: string) => void;
  
  // Optional keyboard event handler (e.g., for handling 'Enter')
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;

  // Autofocus the input on mount
  autoFocus?: boolean;
}

export function DestinationAutocomplete({
  value,
  onChange,
  placeholder = 'Add a city...',
  label: _label, // Intentionally unused - handled by external UI
  disabled = false,
  className = '',
  onSelect,
  onKeyDown,
  autoFocus = false,
}: DestinationAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // City search: SerpAPI + fuzzy fallback. Show dropdown as soon as user types 1+ char.
  useEffect(() => {
    if (!value.trim() || value.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsLoading(true);
      const q = value.trim();
      try {
        const response = await destinations.autocomplete(q, 12);
        const raw = response?.suggestions ?? [];
        let cities: CitySuggestion[];
        if (raw.length > 0) {
          cities = raw
            .filter((s) => (s.name || '').trim())
            .map((s) => ({
              name: (s.name || '').trim(),
              city_id: s.id || s.airports?.[0]?.city_id || s.name || '',
              country: s.description || '',
              airport_code: s.airports?.[0]?.id || (s.airports?.length ? s.airports.map((a) => a.id).filter(Boolean).join(',') : undefined),
              transport_modes: s.airports?.length ? ['flight'] : [],
            }));
        } else {
          const fallbackRes = await destinations.fallbackDestinations(q, 12);
          const fallbackRaw = fallbackRes?.suggestions ?? [];
          if (fallbackRaw.length > 0) {
            cities = fallbackRaw
              .filter((s) => (s.name || '').trim())
              .map((s) => ({
                name: (s.name || '').trim(),
                city_id: s.id || s.airports?.[0]?.city_id || s.name || '',
                country: s.description || '',
                airport_code: s.airports?.[0]?.id || (s.airports?.length ? s.airports.map((a) => a.id).filter(Boolean).join(',') : undefined),
                transport_modes: s.airports?.length ? ['flight'] : [],
              }));
          } else {
            cities = filterFallbackCities(q, 12);
          }
        }
        setSuggestions(cities);
        setShowSuggestions(true);
        setHighlightIndex(cities.length > 0 ? 0 : -1);
      } catch (error) {
        console.error('[DestinationAutocomplete] Error searching cities:', error);
        const fallback = filterFallbackCities(q, 12);
        setSuggestions(fallback);
        setShowSuggestions(true);
        setHighlightIndex(fallback.length > 0 ? 0 : -1);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [value]);

  const handleSelect = (city: CitySuggestion) => {
    // Format with airport code if available
    let formattedValue = city.name;
    if (city.airport_code) {
      formattedValue = `${city.name} (${city.airport_code})`;
    }
    
    onChange(formattedValue);
    if (onSelect) {
      onSelect(formattedValue);
    }
    setShowSuggestions(false);
    setHighlightIndex(-1);
  };

  const handleKeyDownInternal = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) {
      // If no suggestions, handle Enter and Escape normally
      if (e.key === 'Enter') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          e.preventDefault();
          onChange(trimmed);
          if (onSelect) {
            onSelect(trimmed);
          }
          setShowSuggestions(false);
          return;
        }
      } else if (e.key === 'Escape') {
        setShowSuggestions(false);
        setHighlightIndex(-1);
      }
      
      // Call external onKeyDown if provided
      if (onKeyDown) {
        onKeyDown(e);
      }
      return;
    }

    // Handle arrow keys for navigation
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((prev) =>
        prev <= 0 ? suggestions.length - 1 : prev - 1,
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const index = highlightIndex >= 0 ? highlightIndex : 0;
      const city = suggestions[index];
      if (city) {
        handleSelect(city);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setHighlightIndex(-1);
    }
    
    // Call external onKeyDown if provided
    if (onKeyDown) {
      onKeyDown(e);
    }
  };

  return (
    <div ref={wrapperRef} className={`relative w-full ${className}`} style={{ position: 'relative', zIndex: 1 }}>
      <div className="relative" style={{ position: 'relative', zIndex: 1 }}>
        <input
          type="text"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => {
            const newValue = e.target.value;
            onChange(newValue);
            // Immediately show suggestions when user types (will be filtered by the useEffect)
            if (newValue.trim().length >= 1) {
              setShowSuggestions(true);
            } else {
              setShowSuggestions(false);
            }
          }}
          onKeyDown={handleKeyDownInternal}
          onFocus={() => {
            if (value.trim().length >= 1) setShowSuggestions(true);
          }}
          onBlur={(e) => {
            // Don't hide if clicking inside the dropdown
            const relatedTarget = e.relatedTarget as Node;
            if (wrapperRef.current?.contains(relatedTarget)) {
              return;
            }
            // Use setTimeout to allow onClick on suggestions to fire first
            setTimeout(() => {
              setShowSuggestions(false);
            }, 250);
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

      {/* Dropdown: show as soon as user types 1+ char — Searching, list, or No cities found */}
      {showSuggestions && value.trim().length >= 1 && (
        <div 
          className="absolute w-full mt-2 bg-white rounded-xl shadow-xl border border-slate-200 max-h-60 overflow-y-auto"
          style={{ 
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 10060,
            marginTop: '0.5rem',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {isLoading ? (
            <div className="px-4 py-6 flex items-center justify-center gap-2 text-slate-600">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <span>Searching...</span>
            </div>
          ) : suggestions.length > 0 ? (
          suggestions.map((city, index) => {
            const cityName = city.name;
            const country = city.country || '';
            const region = city.region || '';
            const isActive = index === highlightIndex;
            
            // Highlight matching text in city name
            const highlightText = (text: string, query: string): React.ReactNode => {
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
            };
            
            return (
              <button
                key={`${city.city_id || cityName}-${index}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSelect(city);
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSelect(city);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSelect(city);
                }}
                onMouseEnter={() => setHighlightIndex(index)}
                className={`w-full px-4 py-3 text-left transition-colors flex items-center gap-3 border-b last:border-0 border-slate-50 cursor-pointer ${
                  isActive ? 'bg-slate-100' : 'hover:bg-slate-50 active:bg-slate-100'
                }`}
              >
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 text-blue-600">
                  <Plane className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900 truncate">
                    {highlightText(cityName, value.trim())}
                  </div>
                  <div className="text-xs text-slate-500 truncate flex items-center gap-1.5">
                    <span>{country} {region ? `• ${region}` : ''}</span>
                    {(() => {
                      const modes = city.transport_modes || [];
                      const hasFlight = modes.includes('flight');
                      const hasGround = modes.includes('bus') || modes.includes('car');
                      if (hasGround && !hasFlight) {
                        return (
                          <span className="inline-flex items-center gap-0.5 text-emerald-600" title="Reachable by bus or car">
                            <Bus className="w-3 h-3" /><Car className="w-3 h-3" />
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>
              </button>
            );
          })
          ) : (
            <div className="px-4 py-6 text-center text-slate-600">
              No cities found. Try a different search (e.g. Paris, Tokyo, New York).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
