'use client';

import { useState, useEffect, useRef } from 'react';
import { Plane } from 'lucide-react';
import { locations, CitySuggestion, NearbyAirport } from '@/lib/api';

interface CityAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onSelect?: (city: CitySuggestion, airports: NearbyAirport[]) => void;
}

export function CityAutocomplete({
  value,
  onChange,
  placeholder = 'Search city...',
  disabled = false,
  className = '',
  onSelect,
}: CityAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCity, setSelectedCity] = useState<CitySuggestion | null>(null);
  const [airports, setAirports] = useState<NearbyAirport[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
        setHighlightIndex(-1);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced autocomplete search
  useEffect(() => {
    const query = value.trim();
    if (!query || query.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      setHighlightIndex(-1);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsLoading(true);
      try {
        const response = await locations.autocomplete(query, 10);
        const cities = response?.cities ?? [];
        setSuggestions(cities);
        if (cities.length > 0) {
          setShowSuggestions(true);
          setHighlightIndex(0);
        } else {
          setShowSuggestions(false);
          setHighlightIndex(-1);
        }
      } catch (error) {
        console.error('[CityAutocomplete] Error fetching city suggestions:', error);
        setSuggestions([]);
        setShowSuggestions(false);
        setHighlightIndex(-1);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [value]);

  const handleSelectCity = async (city: CitySuggestion) => {
    setSelectedCity(city);
    setShowSuggestions(false);
    setHighlightIndex(-1);

    // Update input value to city name
    onChange(city.name);

    // Fetch nearby airports
    try {
      const response = await locations.getAirports(city.city_id, 3);
      const nearby = response?.airports ?? [];
      setAirports(nearby);
      if (onSelect) {
        onSelect(city, nearby);
      }
    } catch (error) {
      console.error('[CityAutocomplete] Error fetching nearby airports:', error);
      setAirports([]);
      if (onSelect) {
        onSelect(city, []);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) {
      return;
    }

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
        void handleSelectCity(city);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setHighlightIndex(-1);
    }
  };

  const renderSecondary = (city: CitySuggestion) => {
    const parts: string[] = [];
    if (city.region) parts.push(city.region);
    if (city.country) parts.push(city.country);
    return parts.join(' • ');
  };

  return (
    <div ref={wrapperRef} className={`relative w-full ${className}`} style={{ position: 'relative', zIndex: 1 }}>
      <div className="relative" style={{ position: 'relative', zIndex: 10 }}>
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (e.target.value.trim().length >= 1) {
              setShowSuggestions(true);
            } else {
              setShowSuggestions(false);
              setHighlightIndex(-1);
            }
          }}
          onKeyDown={handleKeyDown}
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

      {showSuggestions && suggestions.length > 0 && (
        <div
          className="absolute w-full mt-2 bg-white rounded-xl shadow-xl border border-slate-100 max-h-60 overflow-y-auto"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 99999,
            marginTop: '0.5rem',
            boxShadow:
              '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {suggestions.map((city, index) => {
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
                key={city.city_id}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleSelectCity(city);
                }}
                onMouseEnter={() => setHighlightIndex(index)}
                className={`w-full px-4 py-3 text-left flex items-center gap-3 border-b last:border-0 border-slate-50 cursor-pointer transition-colors ${
                  isActive ? 'bg-slate-100' : 'hover:bg-slate-50'
                }`}
              >
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 text-blue-600">
                  <Plane className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900 truncate">
                    {highlightText(city.name, value.trim())}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {renderSecondary(city)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedCity && airports.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {airports.map((ap) => (
            <span
              key={ap.iata}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium"
            >
              <Plane className="w-3 h-3" />
              {ap.iata}
              {ap.distance_km != null && (
                <span className="text-[11px] text-blue-500">
                  • {ap.distance_km.toFixed(0)} km
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

