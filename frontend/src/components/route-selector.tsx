'use client';

import { useState, useRef } from 'react';
import { Popover, Dialog } from 'react-aria-components';
import { ChevronDown, MapPin, Zap, TrendingUp } from 'lucide-react';

interface Route {
  id: number;
  name: string;
  cities: { name: string; days: number }[];
  totalCost: number;
  pointsCost: number;
  score: number;
}

interface RouteSelectorProps {
  routes: Route[];
  selectedRoute: Route | null;
  onSelectRoute: (route: Route) => void;
  disabled?: boolean;
}

export default function RouteSelector({
  routes,
  selectedRoute,
  onSelectRoute,
  disabled = false,
}: RouteSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative w-full">
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent hover:border-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between text-left"
      >
        <div className="flex-1 min-w-0">
          {selectedRoute ? (
            <div>
              <div className="font-medium text-slate-900 truncate">{selectedRoute.name}</div>
              <div className="text-sm text-slate-500 mt-0.5">
                {selectedRoute.cities.length} cities • {selectedRoute.cities.reduce((sum, c) => sum + c.days, 0)} days • Score: {selectedRoute.score}/100
              </div>
            </div>
          ) : (
            <div>
              <div className="font-medium text-slate-400">Select a route</div>
              <div className="text-sm text-slate-400 mt-0.5">{routes.length} routes available</div>
            </div>
          )}
        </div>
        <ChevronDown className={`w-5 h-5 text-slate-400 flex-shrink-0 ml-2 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <Popover
          isOpen={isOpen}
          onOpenChange={setIsOpen}
          placement="bottom start"
          offset={8}
          triggerRef={triggerRef}
          className="z-50 rounded-xl bg-white border border-slate-200 shadow-lg max-h-96 overflow-y-auto w-full"
        >
          <Dialog className="p-2">
            <div className="space-y-1">
              {routes.map((route) => (
                <button
                  key={route.id}
                  type="button"
                  onMouseDown={(e) => {
                    // Prevent blur/close before click registers
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelectRoute(route);
                    setIsOpen(false);
                  }}
                  className={`w-full p-4 rounded-lg text-left transition-colors ${
                    selectedRoute?.id === route.id
                      ? 'bg-blue-50 border-2 border-blue-600'
                      : 'bg-white border-2 border-transparent hover:bg-slate-50 hover:border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold text-slate-900">{route.name}</h4>
                        {route.score >= 90 && (
                          <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium">
                            Best match
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-600 mb-2">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {route.cities.length} cities
                        </span>
                        <span className="flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" />
                          {route.score}/100
                        </span>
                        <span className="flex items-center gap-1">
                          <Zap className="w-3 h-3" />
                          {(route.pointsCost / 1000).toFixed(0)}k pts
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {route.cities.map(c => {
                          // Handle case where city name might be a UUID or missing
                          const cityName = typeof c === 'string' ? c : (c.name || 'Unknown City');
                          // If it looks like a UUID, show a placeholder instead
                          const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cityName);
                          return isUUID ? 'City (Resolving...)' : cityName;
                        }).join(' → ')}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                    <div className="text-sm font-semibold text-slate-900">
                      ${route.totalCost.toLocaleString()}
                    </div>
                    {selectedRoute?.id === route.id && (
                      <div className="text-xs text-blue-600 font-medium">Selected</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </Dialog>
        </Popover>
      )}
    </div>
  );
}
