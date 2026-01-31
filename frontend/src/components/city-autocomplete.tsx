'use client';

import { useState, useEffect, useRef } from 'react';
import { Plane } from 'lucide-react';
import { cities as citiesAPI, CitySearchResult } from '@/lib/api';

// Client-side response cache for fast repeat searches
const cityCache = new Map<string, { data: CitySearchResult[]; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedCities(query: string): CitySearchResult[] | null {
  const cached = cityCache.get(query.toLowerCase());
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  return null;
}

function setCachedCities(query: string, data: CitySearchResult[]) {
  // Limit cache size
  if (cityCache.size > 100) {
    const oldestKey = cityCache.keys().next().value;
    if (oldestKey) cityCache.delete(oldestKey);
  }
  cityCache.set(query.toLowerCase(), { data, timestamp: Date.now() });
}

interface CityAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (city: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function CityAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = 'Add a city...',
  disabled = false,
}: CityAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<CitySearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
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

  // Optimized search with caching and reduced debounce
  useEffect(() => {
    // Only search if user has typed at least 1 character
    if (!value.trim() || value.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const query = value.trim();
    
    // Check client-side cache first (instant response)
    const cached = getCachedCities(query);
    if (cached) {
      setSuggestions(cached);
      setShowSuggestions(cached.length > 0);
      setIsLoading(false);
      return;
    }

    // Reduced debounce from 300ms to 100ms for faster response
    const timeoutId = setTimeout(async () => {
      setIsLoading(true);
      try {
        // Search with the query - backend handles fuzzy matching
        const response = await citiesAPI.search(query, 12);
        
        if (!response || !response.cities) {
          console.warn('Invalid response from cities API:', response);
          setSuggestions([]);
          setShowSuggestions(false);
          setIsLoading(false);
          return;
        }
        
        // Sort results to prioritize exact matches and city name matches
        const sortedResults = response.cities.sort((a, b) => {
          const queryLower = query.toLowerCase();
          const aName = (a.name || a.cityName || '').toLowerCase();
          const bName = (b.name || b.cityName || '').toLowerCase();
          const aCountry = (a.countryName || '').toLowerCase();
          const bCountry = (b.countryName || '').toLowerCase();
          
          // Exact match in city name gets highest priority
          if (aName === queryLower && bName !== queryLower) return -1;
          if (bName === queryLower && aName !== queryLower) return 1;
          
          // Starts with query gets second priority
          if (aName.startsWith(queryLower) && !bName.startsWith(queryLower)) return -1;
          if (bName.startsWith(queryLower) && !aName.startsWith(queryLower)) return 1;
          
          // City name contains query gets third priority
          if (aName.includes(queryLower) && !bName.includes(queryLower)) return -1;
          if (bName.includes(queryLower) && !aName.includes(queryLower)) return 1;
          
          // Country match gets fourth priority
          if (aCountry.includes(queryLower) && !bCountry.includes(queryLower)) return -1;
          if (bCountry.includes(queryLower) && !aCountry.includes(queryLower)) return 1;
          
          return 0;
        });
        
        const finalResults = sortedResults.slice(0, 10);
        setSuggestions(finalResults);
        // Cache the results for future searches
        setCachedCities(query, finalResults);
        
        // Always show suggestions if we have results
        if (finalResults.length > 0) {
          setShowSuggestions(true);
        } else {
          setShowSuggestions(false);
        }
      } catch (error) {
        console.error('Error searching cities:', error);
        setSuggestions([]);
        setShowSuggestions(false);
      } finally {
        setIsLoading(false);
      }
    }, 100); // Reduced from 300ms to 100ms

    return () => clearTimeout(timeoutId);
  }, [value]);

  const handleSelect = (city: CitySearchResult) => {
    const cityName = city.name || city.cityName || '';
    const iataCode = city.iataCode || city.id || '';
    
    // Format as "City (Code)" like Figma design, or just city name if no code
    const formattedValue = iataCode && iataCode.length === 3 
      ? `${cityName} (${iataCode.toUpperCase()})`
      : cityName;
    
    onSelect(formattedValue);
    onChange(formattedValue); // Set the input value to the formatted city
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && suggestions.length > 0) {
      e.preventDefault();
      handleSelect(suggestions[0]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full" style={{ position: 'relative', zIndex: 1 }}>
      <div className="relative" style={{ position: 'relative', zIndex: 1 }}>
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const newValue = e.target.value;
            onChange(newValue);
            // Immediately show suggestions when user types (will be filtered by the useEffect)
            if (newValue.trim().length >= 1) {
              console.log('[CityAutocomplete] User typing, showing suggestions for:', newValue);
              setShowSuggestions(true);
            } else {
              setShowSuggestions(false);
            }
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            // Show suggestions if we have any and user has typed something
            if (value.trim().length >= 1 && suggestions.length > 0) {
              setShowSuggestions(true);
            }
          }}
          onBlur={(e) => {
            // Don't hide if clicking inside the dropdown
            const relatedTarget = e.relatedTarget as Node;
            if (wrapperRef.current?.contains(relatedTarget)) {
              return;
            }
            // Use setTimeout to allow onClick on suggestions to fire first
            // Increased timeout to ensure dropdown clicks register
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

      {showSuggestions && suggestions.length > 0 && (
        <div 
          className="absolute w-full mt-2 bg-white rounded-xl shadow-xl border border-slate-100 max-h-60 overflow-y-auto"
          style={{ 
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 9999,
            marginTop: '0.5rem',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
          }}
          onMouseDown={(e) => {
            // Prevent blur event when clicking inside dropdown
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            // Prevent input blur when clicking in dropdown
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {suggestions.map((city, index) => {
            const cityName = city.name || city.cityName || '';
            const country = city.countryName || '';
            const region = city.regionCode || '';
            
            // Highlight matching text
            const highlightText = (text: string, query: string): React.ReactNode => {
              if (!text || !query) return text;
              const lowerText = text.toLowerCase();
              const queryLower = query.toLowerCase();
              const index = lowerText.indexOf(queryLower);
              if (index === -1) return text;
              
              const before = text.substring(0, index);
              const match = text.substring(index, index + query.length);
              const after = text.substring(index + query.length);
              
              return (
                <>
                  {before}
                  <span className="font-semibold bg-yellow-100">{match}</span>
                  {after}
                </>
              );
            };
            
            const iataCode = city.iataCode || city.id || '';
            const displayCode = iataCode && iataCode.length === 3 ? iataCode.toUpperCase() : '';
            
            return (
              <button
                key={`${city.id || cityName}-${index}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSelect(city);
                }}
                className="w-full px-4 py-3 text-left hover:bg-slate-50 active:bg-slate-100 transition-colors flex items-center gap-3 border-b last:border-0 border-slate-50 cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 text-blue-600">
                  <Plane className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900 truncate">
                    {highlightText(cityName, value)}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {country} {displayCode ? `• ${displayCode}` : ''} {region ? `• ${region}` : ''}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
