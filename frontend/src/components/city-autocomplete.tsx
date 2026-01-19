'use client';

import { useState, useEffect, useRef } from 'react';
import { MapPin } from 'lucide-react';
import { cities as citiesAPI, CitySearchResult } from '@/lib/api';

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

  // Debounced search with fuzzy matching
  useEffect(() => {
    if (!value.trim() || value.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsLoading(true);
      try {
        // Search with the query - backend handles fuzzy matching
        const response = await citiesAPI.search(value, 12);
        
        // Sort results to prioritize exact matches and city name matches
        const sortedResults = response.cities.sort((a, b) => {
          const queryLower = value.toLowerCase();
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
        
        setSuggestions(sortedResults.slice(0, 10));
        setShowSuggestions(sortedResults.length > 0);
      } catch (error) {
        console.error('Error searching cities:', error);
        setSuggestions([]);
        setShowSuggestions(false);
      } finally {
        setIsLoading(false);
      }
    }, 200); // Reduced debounce for faster response

    return () => clearTimeout(timeoutId);
  }, [value]);

  const handleSelect = (city: CitySearchResult) => {
    const cityName = city.name || city.cityName || '';
    onChange(cityName);
    onSelect(cityName);
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
    <div ref={wrapperRef} className="relative flex-1">
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => value.length >= 1 && suggestions.length > 0 && setShowSuggestions(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {isLoading && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
          {suggestions.map((city, index) => {
            const cityName = city.name || city.cityName || '';
            const country = city.countryName || '';
            const region = city.regionCode || '';
            const queryLower = value.toLowerCase();
            
            // Highlight matching text
            const highlightText = (text: string, query: string): React.ReactNode => {
              if (!text || !query) return text;
              const lowerText = text.toLowerCase();
              const index = lowerText.indexOf(query.toLowerCase());
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
            
            return (
              <button
                key={`${city.id || cityName}-${index}`}
                onClick={() => handleSelect(city)}
                className="w-full px-4 py-3 text-left hover:bg-blue-50 transition-colors flex items-center gap-3 border-b border-slate-100 last:border-b-0"
              >
                <MapPin className="w-4 h-4 text-blue-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">
                    {highlightText(cityName, value)}
                  </div>
                  {(country || region) && (
                    <div className="text-xs text-slate-500 truncate">
                      {highlightText(country, value)} {region ? `· ${region}` : ''}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
