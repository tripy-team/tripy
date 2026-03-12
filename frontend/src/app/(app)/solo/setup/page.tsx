'use client';

import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { X, Calendar, Zap, MapPin, Plane, Clock, Users, User, Baby, Plus, CreditCard, ChevronDown } from 'lucide-react';
import { solo, users as usersAPI, ExtractedTripInfo, isAuthenticated as checkIsAuthenticated } from '@/lib/api';
import TripChatbotInline from '@/components/trip-chatbot-inline';
import { searchAndFormatAirport } from '@/lib/airport-formatter';
import { searchAndFormatCities } from '@/lib/city-formatter';
import PointsAllocation from '@/components/PointsAllocation';
import { DestinationAutocomplete } from '@/components/ui/DestinationAutocomplete';
import AirportAutocomplete from '@/components/ui/AirportAutocomplete';
import MultiAirportAutocomplete from '@/components/ui/MultiAirportAutocomplete';
import DateRangePicker from '@/components/date-range-picker';
import SingleDatePicker from '@/components/ui/SingleDatePicker';
import { ALL_LOYALTY_PROGRAMS, getProgramCategory, isValidProgram } from '@/lib/loyalty-programs';
import { formatProgramName } from '@/lib/programLabels';

// ============================================================================
// SESSION STORAGE PERSISTENCE
// ============================================================================
// Saves form state so it survives sign-in redirects, page refreshes, etc.
// Cleared on successful trip generation (navigation to results page).
// ============================================================================
const SETUP_STORAGE_KEY = 'tripy_solo_setup_state';

interface SavedSetupState {
  adults: number;
  children: number;
  maxBudget: number | '';
  startAirports: string[];
  endAirports: string[];
  cities: string[];
  startDate: string;
  endDate: string;
  isFlexible: boolean;
  flexibleDuration: number;
  isRoundTrip: boolean;
  flightClass: string;
  moneySaverMode: boolean;
  includeBudgetAirlines: boolean;
  maxStops: number;
  departureHourStart: number;
  departureHourEnd: number;
  arrivalHourStart: number;
  arrivalHourEnd: number;
  legDates: string[];
  creditCards: CreditCardEntry[];
  pointsToUse: Record<string, number>;
  savedAt: number; // timestamp for expiry
}

function loadSavedState(): SavedSetupState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SETUP_STORAGE_KEY);
    if (!raw) return null;
    const parsed: SavedSetupState = JSON.parse(raw);
    // Expire after 1 hour
    if (Date.now() - parsed.savedAt > 60 * 60 * 1000) {
      sessionStorage.removeItem(SETUP_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearSavedState(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(SETUP_STORAGE_KEY);
}

// Popular programs for quick-add on the setup page
const QUICK_ADD_PROGRAMS = [
  'Chase Ultimate Rewards',
  'Amex Membership Rewards',
  'Capital One Miles',
  'Delta SkyMiles',
  'United MileagePlus',
  'American Airlines AAdvantage',
];

interface CreditCardEntry {
  id: string;
  program: string;
  points: number;
  owner: string; // "me" = user's own account, anything else = another person donating points
}

function SoloTripSetupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editTripId = searchParams?.get('trip_id') || '';

  // Edit mode: when trip_id is in the URL, we load that trip and update it
  const [isEditMode, setIsEditMode] = useState(false);
  const [editTripLoading, setEditTripLoading] = useState(!!editTripId);

  // Load saved state once (before first render takes effect)
  const savedState = useRef<SavedSetupState | null>(null);
  if (savedState.current === undefined || savedState.current === null) {
    savedState.current = loadSavedState();
  }
  const s = savedState.current; // shorthand

  // Party Size State
  const [adults, setAdults] = useState(s?.adults ?? 1);
  const [children, setChildren] = useState(s?.children ?? 0);
  
  // Budget State
  const [maxBudget, setMaxBudget] = useState<number | ''>(s?.maxBudget ?? '');
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  // Credit Card State
  const [creditCards, setCreditCards] = useState<CreditCardEntry[]>(s?.creditCards ?? []);
  const [pointsToUse, setPointsToUse] = useState<Record<string, number>>(s?.pointsToUse ?? {}); // card.id -> points to use for this trip
  const [showPointsAllocationModal, setShowPointsAllocationModal] = useState(false);

  // Add Points Modal State (for users who haven't signed up)
  const [isUserAuthenticated, setIsUserAuthenticated] = useState(false);
  const [showAddPointsModal, setShowAddPointsModal] = useState(false);
  const [newProgram, setNewProgram] = useState('');
  const [newPoints, setNewPoints] = useState('');
  const [newCategory, setNewCategory] = useState<'credit' | 'airline'>('credit');
  const [newCardProduct, setNewCardProduct] = useState('');
  const [newOwnerType, setNewOwnerType] = useState<'me' | 'other'>('me'); // whose card is being added
  const [newOwnerName, setNewOwnerName] = useState(''); // name when owner is someone else
  const [showOwnerDropdown, setShowOwnerDropdown] = useState(false); // dropdown for existing owners
  const [showProgramDropdown, setShowProgramDropdown] = useState(false);
  const [programSearchQuery, setProgramSearchQuery] = useState('');

  // Date & Duration State
  const [isFlexible, setIsFlexible] = useState(s?.isFlexible ?? false);
  const [startDate, setStartDate] = useState(s?.startDate ?? '');
  const [endDate, setEndDate] = useState(s?.endDate ?? '');
  const [isOneWay, setIsOneWay] = useState(false);
  const [flexibleDuration, setFlexibleDuration] = useState(s?.flexibleDuration ?? 7); // Default days if flexible
  
  // Multi-city leg dates: each element is the departure date for that leg
  // Leg 0: origin → city[0], Leg 1: city[0] → city[1], ..., Last leg: city[n-1] → final destination
  const [legDates, setLegDates] = useState<string[]>(s?.legDates ?? []);

  // Cities State
  const [cities, setCities] = useState<string[]>(s?.cities ?? []);
  const [newCity, setNewCity] = useState('');
  const [showAddDestination, setShowAddDestination] = useState(false);
  
  // Start and End Destination State (now supports multiple airports)
  const [startAirports, setStartAirports] = useState<string[]>(s?.startAirports ?? []);
  const [endAirports, setEndAirports] = useState<string[]>(s?.endAirports ?? []);
  const [isRoundTrip, setIsRoundTrip] = useState(s?.isRoundTrip ?? false);

  // Travel Style State
  const [flightClass, setFlightClass] = useState(s?.flightClass ?? 'economy');

  // Optimization Mode - OOP by default, money-saver mode for aggressive points usage
  const [moneySaverMode, setMoneySaverMode] = useState(s?.moneySaverMode ?? false);
  const optimizationMode = moneySaverMode ? 'money_saving' : 'oop';

  // Hotel recommendations
  const [includeHotels, setIncludeHotels] = useState(false);

  // Advanced Flight Filters
  const [includeBudgetAirlines, setIncludeBudgetAirlines] = useState(s?.includeBudgetAirlines ?? false);
  const [maxStops, setMaxStops] = useState(s?.maxStops ?? 0); // 0=Any, 1=Nonstop, 2=1 stop or fewer, 3=2 stops or fewer
  const [departureHourStart, setDepartureHourStart] = useState(s?.departureHourStart ?? 0);
  const [departureHourEnd, setDepartureHourEnd] = useState(s?.departureHourEnd ?? 23);
  const [arrivalHourStart, setArrivalHourStart] = useState(s?.arrivalHourStart ?? 0);
  const [arrivalHourEnd, setArrivalHourEnd] = useState(s?.arrivalHourEnd ?? 23);

  // Helper: format hour (0-23) to display string
  const formatHour = (h: number): string => {
    if (h === 0) return '12:00 AM';
    if (h < 12) return `${h}:00 AM`;
    if (h === 12) return '12:00 PM';
    return `${h - 12}:00 PM`;
  };

  // Estimates
  const [estimatedCost, setEstimatedCost] = useState(0);
  const [estimatedPoints, setEstimatedPoints] = useState(0);
  const [durationDays, setDurationDays] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculate total points from all cards; total allocated for this trip
  const totalPoints = creditCards.reduce((sum, card) => sum + card.points, 0);
  const totalPointsToUse = creditCards.reduce((sum, card) => sum + (pointsToUse[card.id] ?? card.points), 0);

  // Unique "other" owner names already added (for the dropdown)
  const existingOwnerNames = useMemo(() => {
    const names = creditCards
      .filter(c => c.owner !== 'me')
      .map(c => c.owner);
    return [...new Set(names)];
  }, [creditCards]);

  // Filter programs for the add-points dropdown
  const filteredPrograms = useMemo(() => {
    return ALL_LOYALTY_PROGRAMS.filter(p => {
      const matchesCategory = p.category === newCategory;
      const matchesSearch = !programSearchQuery ||
        p.label.toLowerCase().includes(programSearchQuery.toLowerCase()) ||
        p.value.toLowerCase().includes(programSearchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [newCategory, programSearchQuery]);

  // Close program dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-program-dropdown]') && !target.closest('[data-program-input]')) {
        setShowProgramDropdown(false);
      }
    };
    if (showProgramDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showProgramDropdown]);

  // Close owner dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-owner-dropdown]')) {
        setShowOwnerDropdown(false);
      }
    };
    if (showOwnerDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showOwnerDropdown]);

  const handleProgramSelect = (program: string) => {
    const programInfo = ALL_LOYALTY_PROGRAMS.find(p => p.value === program || p.label === program);
    if (programInfo) {
      setNewProgram(programInfo.value);
      setNewCategory(programInfo.category === 'hotel' ? 'credit' : programInfo.category);
      setShowProgramDropdown(false);
      setProgramSearchQuery('');
    }
  };

  const addPointsCard = () => {
    if (newProgram.trim() && newPoints.trim() && isValidProgram(newProgram)) {
      const programInfo = ALL_LOYALTY_PROGRAMS.find(p => p.value === newProgram || p.label === newProgram);
      const programKey = programInfo?.value || newProgram.trim();
      const newBalance = Number(newPoints.trim());
      const owner = newOwnerType === 'me' ? 'me' : newOwnerName.trim();

      // Owner-aware duplicate check:
      // Same owner + same program → merge balances (e.g., two Platinum cards on one account)
      // Different owner + same program → keep separate (e.g., spouse has their own Amex account)
      const existingIndex = creditCards.findIndex(c => c.program === programKey && c.owner === owner);
      if (existingIndex !== -1) {
        // Same owner, same program — add balances together
        setCreditCards(prev => prev.map((c, i) =>
          i === existingIndex ? { ...c, points: c.points + newBalance } : c
        ));
      } else {
        const card: CreditCardEntry = {
          id: `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          program: programKey,
          points: newBalance,
          owner,
        };
        setCreditCards(prev => [...prev, card]);
      }
      setNewProgram('');
      setNewPoints('');
      setNewCategory('credit');
      setNewCardProduct('');
      setNewOwnerType('me');
      setNewOwnerName('');
      setShowOwnerDropdown(false);
      setProgramSearchQuery('');
      setShowAddPointsModal(false);
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'credit': return 'bg-blue-50 border-blue-200 text-blue-700';
      case 'airline': return 'bg-cyan-50 border-cyan-200 text-cyan-700';
      default: return 'bg-slate-50 border-slate-200 text-slate-700';
    }
  };

  // Scroll to top on mount and keep it at top
  useEffect(() => {
    // Immediate scroll with smooth behavior disabled for instant effect
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    // Also use scrollTo with instant behavior
    if (typeof window !== 'undefined' && window.document) {
      window.document.documentElement.scrollTop = 0;
      window.document.body.scrollTop = 0;
    }
    
    // Scroll again after a brief delay to ensure it stays at top
    const timeoutId = setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      if (typeof window !== 'undefined' && window.document) {
        window.document.documentElement.scrollTop = 0;
        window.document.body.scrollTop = 0;
      }
    }, 100);
    
    // And one more after components are fully rendered (before chatbot focus)
    const timeoutId2 = setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      if (typeof window !== 'undefined' && window.document) {
        window.document.documentElement.scrollTop = 0;
        window.document.body.scrollTop = 0;
      }
    }, 500);
    
    return () => {
      clearTimeout(timeoutId);
      clearTimeout(timeoutId2);
    };
  }, []);

  // Load user profile on mount (gracefully handles anonymous users).
  // In edit mode the trip's stored points are the source of truth, so we
  // skip loading profile credit cards to avoid a race condition where
  // the profile response arrives after the trip load and overwrites the
  // trip-specific points with stale profile data.
  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        setIsLoadingProfile(true);
        if (!checkIsAuthenticated()) {
          setIsUserAuthenticated(false);
          console.log('[SoloSetup] Anonymous session — skipping profile load');
          return;
        }
        setIsUserAuthenticated(true);

        // Skip profile credit-card loading in edit mode — the trip's
        // stored points will be loaded by the trip-loader useEffect.
        if (editTripId) {
          return;
        }
        
        const profile = await usersAPI.getProfile();
        
        if (profile.credit_cards && profile.credit_cards.length > 0) {
          const profileCards = profile.credit_cards.map(card => ({
            id: card.id,
            program: card.program,
            points: card.points,
            owner: card.owner || 'me',
          }));
          if (s && s.creditCards && s.creditCards.length > 0) {
            const profilePrograms = new Set(profileCards.map(c => `${c.program}::${c.owner}`));
            const sessionOnlyCards = s.creditCards.filter(
              c => !profilePrograms.has(`${c.program}::${c.owner}`)
            );
            setCreditCards([...profileCards, ...sessionOnlyCards]);
          } else {
            setCreditCards(profileCards);
          }
        }
      } catch (err) {
        console.error('Error loading user profile:', err);
      } finally {
        setIsLoadingProfile(false);
      }
    };

    loadUserProfile();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load existing trip when editing (trip_id in URL)
  useEffect(() => {
    if (!editTripId) {
      setEditTripLoading(false);
      return;
    }
    const loadTrip = async () => {
      try {
        setEditTripLoading(true);
        const tripData = await solo.getTrip(editTripId);

        setIsEditMode(true);

        // Pre-fill form fields from the trip data
        if (tripData.origin) {
          setStartAirports(tripData.origin.split(',').map(a => a.trim()).filter(Boolean));
        }
        if (tripData.finalDestination) {
          const isSameAsOrigin = tripData.tripType === 'round_trip';
          if (!isSameAsOrigin) {
            setEndAirports(tripData.finalDestination.split(',').map(a => a.trim()).filter(Boolean));
          }
        }
        if (tripData.destinations) {
          setCities(tripData.destinations);
        }
        setIsRoundTrip(tripData.tripType === 'round_trip');
        setIsFlexible(tripData.dateMode === 'flexible');
        if (tripData.startDate) setStartDate(tripData.startDate);
        if (tripData.endDate) setEndDate(tripData.endDate);
        if (tripData.durationDays) setFlexibleDuration(tripData.durationDays);
        if (tripData.maxBudget) setMaxBudget(tripData.maxBudget);
        if (tripData.adults) setAdults(tripData.adults);
        if (tripData.children != null) setChildren(tripData.children);
        if (tripData.flightClass) setFlightClass(tripData.flightClass);
        if (tripData.optimizationMode === 'money_saving') setMoneySaverMode(true);

        // Load advanced filters from trip response
        const raw = tripData as unknown as Record<string, unknown>;
        if (raw.includeBudgetAirlines != null) setIncludeBudgetAirlines(!!raw.includeBudgetAirlines);
        if (raw.maxStops != null) setMaxStops(Number(raw.maxStops));
        const depRange = raw.departureHourRange as number[] | undefined;
        if (depRange && depRange.length === 2) {
          setDepartureHourStart(depRange[0]);
          setDepartureHourEnd(depRange[1]);
        }
        const arrRange = raw.arrivalHourRange as number[] | undefined;
        if (arrRange && arrRange.length === 2) {
          setArrivalHourStart(arrRange[0]);
          setArrivalHourEnd(arrRange[1]);
        }
        const rawLegDates = raw.legDates as string[] | undefined;
        if (rawLegDates && rawLegDates.length > 0) {
          setLegDates(rawLegDates);
        }

        // Load points associated with the trip.
        // The backend stores canonical keys (e.g. "chase_ur") so we convert
        // them to display names ("Chase Ultimate Rewards") that the UI expects.
        try {
          const pointsSummary = await solo.getPoints(editTripId);
          if (pointsSummary.items && pointsSummary.items.length > 0) {
            const cards = pointsSummary.items.map((item: { program: string; balance: number }, idx: number) => {
              const displayName = formatProgramName(item.program);
              return {
                id: `edit-${idx}-${Date.now()}`,
                program: displayName,
                points: item.balance,
                owner: 'me',
              };
            });
            setCreditCards(cards);
          }
        } catch {
          console.log('[SoloSetup] Could not load points for edit mode');
        }
      } catch (err) {
        console.error('Error loading trip for editing:', err);
        setIsEditMode(false);
      } finally {
        setEditTripLoading(false);
      }
    };
    loadTrip();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTripId]);

  // Save credit cards when they change (only for authenticated users).
  // Skip in edit mode — cards loaded from the trip's points store use internal
  // program keys (e.g. "chase_ur") that the profile API doesn't accept.
  useEffect(() => {
    if (!isLoadingProfile && !isEditMode) {
      const saveProfile = async () => {
        try {
          if (!checkIsAuthenticated()) return;
          
          await usersAPI.updateProfile({
            credit_cards: creditCards,
          });
        } catch (err) {
          console.error('Error saving user profile:', err);
        }
      };

      const timeoutId = setTimeout(saveProfile, 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [creditCards, isLoadingProfile, isEditMode]);

  // ============================================================
  // PERSIST FORM STATE TO SESSION STORAGE
  // ============================================================
  // Debounced save: writes all user-entered form fields so they
  // survive sign-in redirects, page refreshes, and back-navigation.
  // ============================================================
  useEffect(() => {
    // Don't save while the profile is still loading (avoids overwriting
    // saved state with defaults before profile credit cards load).
    if (isLoadingProfile) return;

    const timeoutId = setTimeout(() => {
      try {
        const state: SavedSetupState = {
          adults,
          children,
          maxBudget,
          startAirports,
          endAirports,
          cities,
          startDate,
          endDate,
          isFlexible,
          flexibleDuration,
          isRoundTrip,
          flightClass,
          moneySaverMode,
          includeBudgetAirlines,
          maxStops,
          departureHourStart,
          departureHourEnd,
          arrivalHourStart,
          arrivalHourEnd,
          legDates,
          creditCards,
          pointsToUse,
          savedAt: Date.now(),
        };
        sessionStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(state));
      } catch {
        // sessionStorage may be full or unavailable — silently ignore
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [
    adults, children, maxBudget, startAirports, endAirports, cities,
    startDate, endDate, isFlexible, flexibleDuration, isRoundTrip,
    flightClass, moneySaverMode, includeBudgetAirlines, maxStops,
    departureHourStart, departureHourEnd, arrivalHourStart, arrivalHourEnd,
    legDates, creditCards, pointsToUse, isLoadingProfile,
  ]);

  // Sync end airports with start airports if round trip
  // This ensures end airports ALWAYS match start when round trip is enabled
  useEffect(() => {
    if (isRoundTrip) {
      // Always sync when round trip is enabled and start airports change
      setEndAirports(startAirports);
    }
  }, [startAirports, isRoundTrip]);

  // Handle extracted trip info from chatbot
  const handleExtract = async (info: ExtractedTripInfo) => {
    // Extract and format start destination as airport code
    if (info.startDestination) {
      try {
        const airportCode = await searchAndFormatAirport(info.startDestination);
        // Add to start airports if not already present
        setStartAirports(prev => prev.includes(airportCode) ? prev : [...prev, airportCode]);
      } catch (error) {
        console.error('Error formatting start destination:', error);
        // Try to add raw value if it looks like an IATA code
        if (/^[A-Z]{3}$/i.test(info.startDestination.trim())) {
          const code = info.startDestination.trim().toUpperCase();
          setStartAirports(prev => prev.includes(code) ? prev : [...prev, code]);
        }
      }
    }

    // Extract and format end destination as airport code
    if (info.endDestination) {
      try {
        const airportCode = await searchAndFormatAirport(info.endDestination);
        // Add to end airports if not already present
        setEndAirports(prev => prev.includes(airportCode) ? prev : [...prev, airportCode]);
        
        // Auto-detect round trip if start and end are the same
        if (info.startDestination && info.endDestination) {
          const startNorm = info.startDestination.toLowerCase().replace(/\s+/g, ' ').trim();
          const endNorm = info.endDestination.toLowerCase().replace(/\s+/g, ' ').trim();
          if (startNorm === endNorm) {
            setIsRoundTrip(true);
          }
        }
      } catch (error) {
        console.error('Error formatting end destination:', error);
        // Try to add raw value if it looks like an IATA code
        if (/^[A-Z]{3}$/i.test(info.endDestination.trim())) {
          const code = info.endDestination.trim().toUpperCase();
          setEndAirports(prev => prev.includes(code) ? prev : [...prev, code]);
        }
      }
    }

    // Extract cities (destinations) - search and format with airport codes
    if (info.cities && info.cities.length > 0) {
      try {
        const formattedCities = await searchAndFormatCities(info.cities);
        if (formattedCities && formattedCities.length > 0) {
          setCities(prevCities => {
            const newCities = formattedCities.filter(city => city && !prevCities.includes(city));
            return newCities.length > 0 ? [...prevCities, ...newCities] : prevCities;
          });
        } else {
          // If formatting returns empty, use original cities
          setCities(prevCities => {
            const newCities = info.cities.filter(city => city && !prevCities.includes(city));
            return newCities.length > 0 ? [...prevCities, ...newCities] : prevCities;
          });
        }
      } catch (error) {
        console.error('Error formatting cities:', error);
        // Fallback to unformatted cities - ensure they're added
        setCities(prevCities => {
          const newCities = info.cities.filter(city => city && !prevCities.includes(city));
          return newCities.length > 0 ? [...prevCities, ...newCities] : prevCities;
        });
      }
    }

    // Extract dates - populate dates section
    if (info.startDate) {
      setStartDate(info.startDate);
    }
    if (info.endDate) {
      setEndDate(info.endDate);
    }
    if (info.duration !== undefined && info.duration !== null && !info.startDate && !info.endDate) {
      setIsFlexible(true);
      setFlexibleDuration(info.duration);
    }
    if (info.isFlexible !== undefined && info.isFlexible !== null) {
      setIsFlexible(info.isFlexible);
    }

    // Extract budget - populate budget section
          if (info.maxBudget !== undefined && info.maxBudget !== null) {
            setMaxBudget(info.maxBudget);
          }

    // Extract credit cards - populate credit cards section
    if (info.creditCards && info.creditCards.length > 0) {
      setCreditCards(prevCards => {
        const newCards = info.creditCards!.map((card, index) => ({
          id: `extracted-${Date.now()}-${index}`,
          program: card.program,
          points: card.points,
          owner: 'me' as string, // Extracted cards are the user's own
        }));
        // Same-owner merge: combine balances for duplicate programs from the same owner
        const merged = [...prevCards];
        for (const newCard of newCards) {
          const existingIndex = merged.findIndex(c => c.program === newCard.program && c.owner === newCard.owner);
          if (existingIndex !== -1) {
            merged[existingIndex] = { ...merged[existingIndex], points: merged[existingIndex].points + newCard.points };
          } else {
            merged.push(newCard);
          }
        }
        return merged;
      });
    }

    // Extract travel style preferences
    if (info.flightClass) {
      setFlightClass(info.flightClass);
    }
  };

  // Calculate Duration
  useEffect(() => {
    if (isFlexible) {
      setDurationDays(flexibleDuration);
    } else {
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        setDurationDays(diffDays > 0 ? diffDays : 0);
      } else {
        setDurationDays(0);
      }
    }
  }, [startDate, endDate, isFlexible, flexibleDuration]);

  // Real-time cost calculation
  useEffect(() => {
    const baseCostPerDay = 200;
    const baseCostPerCity = 300;
    const estimated = (durationDays * baseCostPerDay) + (cities.length * baseCostPerCity);
    setEstimatedCost(estimated);
    setEstimatedPoints(Math.floor(estimated * 25)); // Rough points calculation
  }, [durationDays, cities.length]);

  const removeCity = (city: string) => {
    setCities(cities.filter(c => c !== city));
  };

  const removeCreditCard = (id: string) => {
    setCreditCards(creditCards.filter(card => card.id !== id));
  };

  // Compute flight legs for multi-city trips
  // Returns array of {from, to} objects representing each flight segment
  const getFlightLegs = () => {
    if (startAirports.length === 0 || cities.length === 0) return [];
    
    const legs: Array<{ from: string; to: string; index: number }> = [];
    
    // First leg: origin airports → first city
    const startDisplay = startAirports.length > 1 
      ? startAirports.join(', ') 
      : startAirports[0];
    legs.push({ from: startDisplay, to: cities[0], index: 0 });
    
    // Middle legs: city[i] → city[i+1]
    for (let i = 0; i < cities.length - 1; i++) {
      legs.push({ from: cities[i], to: cities[i + 1], index: i + 1 });
    }
    
    // Last leg: last city → final destination (if not one-way with same end)
    const lastCity = cities[cities.length - 1];
    const finalAirports = isRoundTrip ? startAirports : endAirports;
    const finalDisplay = finalAirports.length > 1
      ? finalAirports.join(', ')
      : finalAirports[0] || '';
    if (finalDisplay && finalDisplay !== lastCity) {
      legs.push({ from: lastCity, to: finalDisplay, index: cities.length });
    }
    
    return legs;
  };

  const flightLegs = getFlightLegs();
  const isMultiCity = cities.length > 1;

  // Update leg date at specific index
  const updateLegDate = (index: number, date: string) => {
    setLegDates(prev => {
      const newDates = [...prev];
      // Ensure array is long enough
      while (newDates.length <= index) {
        newDates.push('');
      }
      newDates[index] = date;
      return newDates;
    });
  };

  // Sync legDates when switching between simple and multi-city mode
  // When going from simple to multi-city, populate first leg with startDate
  useEffect(() => {
    if (isMultiCity && legDates.length === 0 && startDate) {
      setLegDates([startDate]);
    }
    // When going back to single city, sync startDate from first leg
    if (!isMultiCity && legDates.length > 0 && legDates[0]) {
      setStartDate(legDates[0]);
    }
  }, [isMultiCity, startDate, legDates]);

  // Get minimum date for a leg (must be on or after previous leg's date)
  // Same-day is allowed to support connecting flights through an airport
  const getMinDateForLeg = (index: number): string => {
    if (index === 0) {
      return new Date().toISOString().split('T')[0]; // Today
    }
    const prevDate = legDates[index - 1];
    if (prevDate) {
      // Allow same day as previous leg (for connecting flights)
      return prevDate;
    }
    return new Date().toISOString().split('T')[0];
  };

  const handleGenerate = async () => {
    // Validate required fields
    if (startAirports.length === 0) {
      setError('Please select at least one departure airport');
      return;
    }
    if (!isRoundTrip && endAirports.length === 0) {
      setError('Please select at least one arrival airport');
      return;
    }
    // Round trip requires at least one destination; one-way can be direct (departure → arrival, no cities)
    if (isRoundTrip && cities.length < 1) {
      setError('Please add at least 1 destination city for a round trip');
      return;
    }
    
    // Validate budget - now required
    if (maxBudget === '' || maxBudget <= 0) {
      setError('Please enter a maximum budget for your trip');
      return;
    }
    
    // Validate dates
    if (!isFlexible) {
      if (!startDate) {
        setError('Please select a departure date');
        return;
      }
      // One-way trips only need departure date; arrival/return date is not used
      if (!isRoundTrip) {
        // One-way: no return/arrival date required
      } else if (!endDate) {
        setError('Please select a return/arrival date');
        return;
      }
      // For multi-city, validate intermediate dates (except the last city which uses endDate)
      if (cities.length > 1) {
        for (let i = 0; i < cities.length - 1; i++) {
          if (!legDates[i + 1]) {
            setError(`Please select a departure date from ${cities[i]}`);
            return;
          }
        }
      }
    }

    setIsGenerating(true);
    setError(null);

    try {
      const tripTitle = cities.length > 0 
        ? `Solo Trip to ${cities[0]}${cities.length > 1 ? ` + ${cities.length - 1} more` : ''}` 
        : 'Solo Trip';
      
      const effectiveStartDate = startDate;
      const effectiveEndDate = endDate;
      const originAirports = startAirports.join(',');
      const finalAirports = isRoundTrip ? startAirports.join(',') : endAirports.join(',');

      const tripParams = {
        title: tripTitle,
        tripType: (isRoundTrip ? 'round_trip' : 'one_way') as 'one_way' | 'round_trip',
        dateMode: (isFlexible ? 'flexible' : 'fixed') as 'fixed' | 'flexible',
        origin: originAirports,
        destinations: cities,
        finalDestination: finalAirports,
        startDate: isFlexible ? undefined : effectiveStartDate,
        endDate: isFlexible ? undefined : (isRoundTrip ? effectiveEndDate : undefined),
        durationDays: isFlexible ? flexibleDuration : undefined,
        includeHotels: includeHotels,
        maxBudget: maxBudget as number,
        adults: adults,
        children: children,
        flightClass: flightClass as 'basic_economy' | 'economy' | 'premium' | 'business' | 'first',
        optimizationMode: optimizationMode as 'oop' | 'cpp' | 'balanced' | 'money_saving',
        legDates: isMultiCity ? legDates : undefined,
        includeBudgetAirlines: includeBudgetAirlines,
        maxStops: maxStops,
        departureHourRange: (departureHourStart !== 0 || departureHourEnd !== 23) ? [departureHourStart, departureHourEnd] as [number, number] : undefined,
        arrivalHourRange: (arrivalHourStart !== 0 || arrivalHourEnd !== 23) ? [arrivalHourStart, arrivalHourEnd] as [number, number] : undefined,
      };

      let tripId: string;

      if (isEditMode && editTripId) {
        // Update existing trip
        const updated = await solo.updateTrip(editTripId, tripParams);
        tripId = updated.tripId;
      } else {
        // Create new trip
        const trip = await solo.createTrip(tripParams);
        tripId = trip.tripId;
      }

      // Sync credit card points. In edit mode, always upsert (even if empty)
      // so that removed programs get cleared from the backend.
      if (creditCards.length > 0) {
        const hasMultipleOwners = creditCards.some(c => c.owner !== 'me');

        if (hasMultipleOwners) {
          const payerPoints: Record<string, Record<string, number>> = {};
          for (const card of creditCards) {
            const ownerKey = card.owner;
            if (!payerPoints[ownerKey]) payerPoints[ownerKey] = {};
            const balance = pointsToUse[card.id] ?? card.points;
            payerPoints[ownerKey][card.program] = (payerPoints[ownerKey][card.program] || 0) + balance;
          }
          const mergedBalances: Record<string, number> = {};
          for (const card of creditCards) {
            const balance = pointsToUse[card.id] ?? card.points;
            mergedBalances[card.program] = (mergedBalances[card.program] || 0) + balance;
          }
          const pointsBalances = Object.entries(mergedBalances).map(([program, balance]) => ({
            program,
            balance,
          }));
          await solo.upsertPoints(tripId, pointsBalances);
          sessionStorage.setItem(`payer_points_${tripId}`, JSON.stringify(payerPoints));
        } else {
          const pointsBalances = creditCards.map(card => ({
            program: card.program,
            balance: pointsToUse[card.id] ?? card.points,
          }));
          await solo.upsertPoints(tripId, pointsBalances);
        }
      } else if (isEditMode) {
        // No cards left — clear all points from the trip
        await solo.upsertPoints(tripId, []);
      }

      clearSavedState();
      sessionStorage.setItem('tripy_last_trip_id', tripId);
      localStorage.setItem('tripy_last_trip_id', tripId);
      router.push(`/solo/results?trip_id=${tripId}`);
    } catch (err) {
      console.error('Error generating itinerary:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate itinerary. Please try again.');
      setIsGenerating(false);
    }
  };

  return (
    <div data-testid="solo-setup-page" data-slot="SoloTripSetup" className="min-h-full p-6 md:p-8 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl tracking-tight text-slate-900 font-bold">
            {isEditMode ? 'Edit Your Search' : 'Book Your Flight'}
          </h1>
          <p className="text-slate-500 mt-1">
            {isEditMode ? 'Modify your trip parameters and re-search for flights' : 'Find the best deals using your points'}
          </p>
        </div>

        {editTripLoading && (
          <div className="mb-8 flex items-center justify-center py-12">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-3" />
              <p className="text-sm text-slate-500">Loading your trip details...</p>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left Column - Main Form */}
          <div className="lg:col-span-2 space-y-6">

            {/* 1. TRAVELERS - Compact horizontal bar */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-6 md:gap-10">
                {/* Adults */}
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 text-blue-600" />
                  <span className="text-sm text-slate-700 font-medium">Adults</span>
                  <div className="flex items-center gap-2 ml-1">
                    <button 
                      type="button"
                      onClick={() => setAdults(Math.max(1, adults - 1))}
                      className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-blue-50 text-slate-600 transition-colors text-sm font-medium"
                    >
                      −
                    </button>
                    <span className="w-5 text-center font-bold text-slate-900">{adults}</span>
                    <button 
                      type="button"
                      onClick={() => setAdults(adults + 1)}
                      className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-blue-50 text-slate-600 transition-colors text-sm font-medium"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Children */}
                <div className="flex items-center gap-3">
                  <Baby className="w-5 h-5 text-blue-600" />
                  <span className="text-sm text-slate-700 font-medium">Children</span>
                  <div className="flex items-center gap-2 ml-1">
                    <button 
                      type="button"
                      onClick={() => setChildren(Math.max(0, children - 1))}
                      className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-blue-50 text-slate-600 transition-colors text-sm font-medium"
                    >
                      −
                    </button>
                    <span className="w-5 text-center font-bold text-slate-900">{children}</span>
                    <button 
                      type="button"
                      onClick={() => setChildren(children + 1)}
                      className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-blue-50 text-slate-600 transition-colors text-sm font-medium"
                    >
                      +
                    </button>
                  </div>
                </div>

              </div>
            </div>

            {/* Your Route - Unified flight booking interface */}
            <div className="relative z-40 bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                  <Plane className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl text-slate-900 font-semibold">Your Route</h2>
                  <p className="text-sm text-slate-500">Build your trip by adding destinations and dates</p>
                </div>
              </div>

              <div className="relative">
                {/* Timeline connector line */}
                <div className="absolute left-[11px] top-8 bottom-8 w-0.5 bg-blue-200 z-0" />
                
                <div className="space-y-0 relative z-10">
                  {/* START LOCATION */}
                  <div className="flex gap-6 pb-4">
                    {/* Timeline dot */}
                    <div className="flex flex-col items-center">
                      <div className="w-6 h-6 rounded-full bg-blue-600 border-4 border-white shadow-sm z-10" />
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 -mt-1">
                      <div>
                        <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                          Departure Airport(s)
                        </label>
                        <MultiAirportAutocomplete
                          value={startAirports}
                          onChange={setStartAirports}
                          placeholder="e.g., JFK, EWR, LGA"
                          maxSelections={5}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                          Departure Date
                        </label>
                        <SingleDatePicker
                          value={startDate}
                          onChange={(date) => {
                            setStartDate(date);
                            // Also update first leg date for multi-city
                            updateLegDate(0, date);
                          }}
                          minDate={new Date().toISOString().split('T')[0]}
                          placeholder="Select date"
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* INTERMEDIATE DESTINATIONS */}
                  {cities.map((city, index) => {
                    // For the last city in a round trip, show "Return Date" using endDate instead of legDates
                    const isLastCity = index === cities.length - 1;
                    
                    return (
                      <div key={`city-${index}`} className="flex gap-6 py-4">
                        {/* Timeline dot */}
                        <div className="flex flex-col items-center">
                          <div className="w-6 h-6 rounded-full bg-blue-500 border-4 border-white shadow-sm z-10 flex items-center justify-center">
                            <span className="text-[8px] text-white font-bold">{index + 1}</span>
                          </div>
                        </div>
                        
                        {/* Content */}
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 -mt-1">
                          <div className="relative">
                            <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                              Destination {index + 1}
                            </label>
                            <div className="flex gap-2">
                              <div className="flex-1 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-slate-900 font-medium">
                                {city}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  removeCity(city);
                                  // Remove the corresponding leg date
                                  setLegDates(prev => {
                                    const newDates = [...prev];
                                    newDates.splice(index + 1, 1);
                                    return newDates;
                                  });
                                }}
                                className="px-3 py-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                                title="Remove destination"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                              {isLastCity && isRoundTrip ? 'Return Date' : 'Departure Date'}
                            </label>
                            {isLastCity && isRoundTrip ? (
                              <SingleDatePicker
                                value={endDate}
                                onChange={(date) => setEndDate(date)}
                                minDate={getMinDateForLeg(index + 1)}
                                disabled={isFlexible}
                                placeholder="Select date"
                              />
                            ) : (
                              <SingleDatePicker
                                value={legDates[index + 1] || ''}
                                onChange={(date) => updateLegDate(index + 1, date)}
                                minDate={getMinDateForLeg(index + 1)}
                                disabled={isFlexible}
                                placeholder="Select date"
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  
                  {/* ADD DESTINATION BUTTON */}
                  <div className="flex gap-6 py-4">
                    {/* Timeline connector */}
                    <div className="flex flex-col items-center">
                      <div className="w-6 h-6 rounded-full bg-white border-2 border-dashed border-slate-300 z-10" />
                    </div>
                    
                    {/* Add button and dropdown */}
                    <div className="flex-1 -mt-1 relative">
                      <button
                        type="button"
                        onClick={() => setShowAddDestination(!showAddDestination)}
                        className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium text-sm"
                      >
                        <Plus className="w-4 h-4" />
                        Add Another Destination
                      </button>
                      
                      {/* Dropdown popup */}
                      {showAddDestination && (
                        <>
                          {/* Backdrop to close on click outside */}
                          <div 
                            className="fixed inset-0 z-40" 
                            onClick={() => {
                              setShowAddDestination(false);
                              setNewCity('');
                            }}
                          />
                          <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg p-4 z-50">
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-xs text-slate-500 font-medium uppercase tracking-wider">
                                Search for a city
                              </label>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowAddDestination(false);
                                  setNewCity('');
                                }}
                                className="text-slate-400 hover:text-slate-600"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                            <DestinationAutocomplete
                              value={newCity}
                              onChange={setNewCity}
                              autoFocus
                              onSelect={(city) => {
                                if (city && !cities.includes(city)) {
                                  setCities(prevCities => [...prevCities, city]);
                                  setNewCity('');
                                  setShowAddDestination(false);
                                }
                              }}
                              placeholder="e.g., Paris, Rome, Tokyo..."
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  
                  {/* FINAL DESTINATION */}
                  <div className="flex gap-6 pt-4">
                    {/* Timeline dot */}
                    <div className="flex flex-col items-center">
                      <div className="w-6 h-6 rounded-full bg-blue-600 border-4 border-white shadow-sm z-10 flex items-center justify-center">
                        <MapPin className="w-3 h-3 text-white" />
                      </div>
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 -mt-1">
                      <div>
                        <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                          Arrival Airport(s)
                        </label>
                        {isRoundTrip ? (
                          <div className="px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-sm text-slate-600 min-h-[46px] flex items-center">
                            {startAirports.length > 0 
                              ? `Same as departure (${startAirports.join(', ')})` 
                              : 'Same as departure airport(s)'}
                          </div>
                        ) : (
                          <MultiAirportAutocomplete
                            value={endAirports}
                            onChange={setEndAirports}
                            placeholder="e.g., JFK, EWR, LGA"
                            maxSelections={5}
                          />
                        )}
                      </div>
                      {/* Arrival/return date: only for round trip when no destinations added (otherwise shown on last destination) */}
                      {isRoundTrip && cities.length === 0 && (
                        <div>
                          <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                            Return Date
                          </label>
                          <SingleDatePicker
                            value={endDate}
                            onChange={(date) => setEndDate(date)}
                            minDate={startDate || new Date().toISOString().split('T')[0]}
                            placeholder="Select date"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Options */}
              <div className="mt-8 pt-6 border-t border-slate-200 flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    checked={isRoundTrip}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setIsRoundTrip(checked);
                      if (checked) {
                        setEndAirports(startAirports);
                        // Preserve the last leg date as endDate so toggling doesn't lose user's work
                        if (cities.length > 0) {
                          const lastLegDate = legDates[cities.length];
                          if (lastLegDate && !endDate) {
                            setEndDate(lastLegDate);
                          }
                        }
                      } else {
                        // Preserve endDate as the last leg date so toggling doesn't lose user's work
                        if (cities.length > 0 && endDate && !legDates[cities.length]) {
                          updateLegDate(cities.length, endDate);
                        }
                      }
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">
                    Start and end at same airport(s)
                  </span>
                </label>
                
              </div>
              
              <p className="mt-4 text-xs text-slate-500">
                Small and regional airports are supported. We include connecting flights when needed.
              </p>
            </div>
            
            {/* 3. TRAVEL STYLE & PREFERENCES */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h2 className="text-lg text-slate-900 font-semibold mb-4">Travel Style & Preferences</h2>
              
              <div className="space-y-5">
                {/* Cabin Class */}
                <div>
                  <label className="block text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">Cabin Class</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: 'basic_economy', label: 'Basic Economy' },
                      { value: 'economy', label: 'Economy' },
                      { value: 'premium', label: 'Premium Economy' },
                      { value: 'business', label: 'Business' },
                      { value: 'first', label: 'First' },
                    ].map((option) => {
                      const isSelected = flightClass === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setFlightClass(option.value)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            isSelected 
                              ? 'bg-blue-600 text-white' 
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Stops Filter */}
                <div>
                  <label className="block text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">Stops</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: 0, label: 'Any' },
                      { value: 1, label: 'Nonstop only' },
                      { value: 2, label: '1 stop or fewer' },
                      { value: 3, label: '2 stops or fewer' },
                    ].map((option) => {
                      const isSelected = maxStops === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setMaxStops(option.value)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            isSelected 
                              ? 'bg-blue-600 text-white' 
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Include Budget Airlines Toggle */}
                <div>
                  <label className="flex items-center gap-3 cursor-pointer select-none group">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={includeBudgetAirlines}
                        onChange={(e) => setIncludeBudgetAirlines(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:bg-blue-600 transition-colors" />
                      <div className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform peer-checked:translate-x-5" />
                    </div>
                    <div>
                      <span className="text-sm text-slate-700 font-medium group-hover:text-slate-900 transition-colors">
                        Include budget airlines
                      </span>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {includeBudgetAirlines 
                          ? 'Showing cheapest flights first (includes all airlines)'
                          : 'Showing best quality flights (excludes ultra-low-cost carriers)'}
                      </p>
                    </div>
                  </label>
                </div>

                {/* Flight Time Preferences */}
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Departure Time */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-xs text-slate-500 font-medium uppercase tracking-wider">
                        Departure Time
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer select-none group">
                        <span className="text-xs text-slate-500 group-hover:text-slate-700 transition-colors">Anytime</span>
                        <div className="relative">
                          <input
                            type="checkbox"
                            checked={departureHourStart === 0 && departureHourEnd === 23}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setDepartureHourStart(0);
                                setDepartureHourEnd(23);
                              } else {
                                setDepartureHourStart(6);
                                setDepartureHourEnd(22);
                              }
                            }}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:bg-blue-600 transition-colors" />
                          <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform peer-checked:translate-x-4" />
                        </div>
                      </label>
                    </div>

                    {/* Range display when custom */}
                    <div
                      className={`overflow-hidden transition-all duration-300 ease-in-out ${
                        departureHourStart === 0 && departureHourEnd === 23
                          ? 'max-h-0 opacity-0'
                          : 'max-h-40 opacity-100'
                      }`}
                    >
                      <div className="text-sm text-slate-700 font-medium mb-2">
                        {formatHour(departureHourStart)} – {formatHour(departureHourEnd)}
                      </div>
                      <div className="px-2.5">
                        <div className="relative h-6">
                          {/* Track background */}
                          <div className="absolute top-1/2 -translate-y-1/2 w-full h-1.5 bg-slate-200 rounded-full" />
                          {/* Active range highlight */}
                          <div
                            className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-blue-500 rounded-full transition-all"
                            style={{
                              left: `${(departureHourStart / 23) * 100}%`,
                              right: `${100 - (departureHourEnd / 23) * 100}%`,
                            }}
                          />
                          {/* Start thumb */}
                          <input
                            type="range"
                            min={0}
                            max={23}
                            value={departureHourStart}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              if (val <= departureHourEnd) setDepartureHourStart(val);
                            }}
                            className="absolute top-0 w-full h-6 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-blue-500 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-blue-500 [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-track]:bg-transparent"
                          />
                          {/* End thumb */}
                          <input
                            type="range"
                            min={0}
                            max={23}
                            value={departureHourEnd}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              if (val >= departureHourStart) setDepartureHourEnd(val);
                            }}
                            className="absolute top-0 w-full h-6 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-blue-500 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-blue-500 [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-track]:bg-transparent"
                          />
                        </div>
                        {/* Time axis labels */}
                        <div className="flex justify-between text-[10px] text-slate-400 mt-1.5 select-none">
                          <span>12 AM</span>
                          <span>6 AM</span>
                          <span>12 PM</span>
                          <span>6 PM</span>
                          <span>11 PM</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Arrival Time */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-xs text-slate-500 font-medium uppercase tracking-wider">
                        Arrival Time
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer select-none group">
                        <span className="text-xs text-slate-500 group-hover:text-slate-700 transition-colors">Anytime</span>
                        <div className="relative">
                          <input
                            type="checkbox"
                            checked={arrivalHourStart === 0 && arrivalHourEnd === 23}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setArrivalHourStart(0);
                                setArrivalHourEnd(23);
                              } else {
                                setArrivalHourStart(6);
                                setArrivalHourEnd(22);
                              }
                            }}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:bg-blue-600 transition-colors" />
                          <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform peer-checked:translate-x-4" />
                        </div>
                      </label>
                    </div>

                    {/* Range display when custom */}
                    <div
                      className={`overflow-hidden transition-all duration-300 ease-in-out ${
                        arrivalHourStart === 0 && arrivalHourEnd === 23
                          ? 'max-h-0 opacity-0'
                          : 'max-h-40 opacity-100'
                      }`}
                    >
                      <div className="text-sm text-slate-700 font-medium mb-2">
                        {formatHour(arrivalHourStart)} – {formatHour(arrivalHourEnd)}
                      </div>
                      <div className="px-2.5">
                        <div className="relative h-6">
                          {/* Track background */}
                          <div className="absolute top-1/2 -translate-y-1/2 w-full h-1.5 bg-slate-200 rounded-full" />
                          {/* Active range highlight */}
                          <div
                            className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-blue-500 rounded-full transition-all"
                            style={{
                              left: `${(arrivalHourStart / 23) * 100}%`,
                              right: `${100 - (arrivalHourEnd / 23) * 100}%`,
                            }}
                          />
                          {/* Start thumb */}
                          <input
                            type="range"
                            min={0}
                            max={23}
                            value={arrivalHourStart}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              if (val <= arrivalHourEnd) setArrivalHourStart(val);
                            }}
                            className="absolute top-0 w-full h-6 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-blue-500 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-blue-500 [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-track]:bg-transparent"
                          />
                          {/* End thumb */}
                          <input
                            type="range"
                            min={0}
                            max={23}
                            value={arrivalHourEnd}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              if (val >= arrivalHourStart) setArrivalHourEnd(val);
                            }}
                            className="absolute top-0 w-full h-6 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-blue-500 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-blue-500 [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-track]:bg-transparent"
                          />
                        </div>
                        {/* Time axis labels */}
                        <div className="flex justify-between text-[10px] text-slate-400 mt-1.5 select-none">
                          <span>12 AM</span>
                          <span>6 AM</span>
                          <span>12 PM</span>
                          <span>6 PM</span>
                          <span>11 PM</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Right Column - Budget, Points & Actions */}
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-24 space-y-4">
              
              {/* Budget - Required */}
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                <label className="block text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">
                  Maximum Budget <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-600 font-bold text-lg">$</span>
                  <input
                    type="number"
                    value={maxBudget}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : '';
                      setMaxBudget(val);
                    }}
                    onWheel={(e) => e.currentTarget.blur()}
                    placeholder="Enter your budget"
                    min="1"
                    required
                    className={`w-full pl-10 pr-4 py-3 bg-blue-50 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-semibold text-slate-900 text-lg ${
                      maxBudget === '' ? 'border-blue-200' : 'border-blue-200'
                    }`}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-2">A lower budget will prioritize more aggressive use of your points</p>

                {/* Money-Saver Mode Toggle */}
                <div className="mt-4 flex items-center justify-between">
                  <div className="flex-1 mr-3">
                    <span className="text-sm font-medium text-slate-700">Money-Saver Mode</span>
                    <p className="text-xs text-slate-400 mt-0.5">Burn points to minimize cash — any stops, duration, or layovers are fair game</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMoneySaverMode(!moneySaverMode)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                      moneySaverMode ? 'bg-green-500' : 'bg-slate-200'
                    }`}
                    role="switch"
                    aria-checked={moneySaverMode}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        moneySaverMode ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Include Hotels Toggle */}
                <div className="mt-4 flex items-center justify-between">
                  <div className="flex-1 mr-3">
                    <span className="text-sm font-medium text-slate-700">Include Hotel Recommendations</span>
                    <p className="text-xs text-slate-400 mt-0.5">Get recommended hotels alongside your flight results</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIncludeHotels(!includeHotels)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                      includeHotels ? 'bg-blue-500' : 'bg-slate-200'
                    }`}
                    role="switch"
                    aria-checked={includeHotels}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        includeHotels ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Points */}
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs text-slate-500 font-medium uppercase tracking-wider">
                    {creditCards.some(c => c.owner !== 'me') ? 'Points' : 'Your Points'}
                  </label>
                  <div className="flex items-center gap-2">
                    {creditCards.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowPointsAllocationModal(true)}
                        className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                      >
                        Adjust
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowAddPointsModal(true)}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  </div>
                </div>

                {creditCards.length > 0 ? (
                  <>
                    <div className="space-y-2">
                      {creditCards.map(card => {
                        const toUse = pointsToUse[card.id] ?? card.points;
                        const category = getProgramCategory(card.program);
                        return (
                          <div key={card.id} className="flex items-center justify-between text-sm group">
                            <div className="flex items-center gap-2 truncate">
                              <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${
                                card.owner !== 'me'
                                  ? 'bg-purple-50 text-purple-600'
                                  : category === 'airline' ? 'bg-cyan-50 text-cyan-600' : 'bg-blue-50 text-blue-600'
                              }`}>
                                {card.owner !== 'me'
                                  ? <Users className="w-3 h-3" />
                                  : category === 'airline' ? <Plane className="w-3 h-3" /> : <CreditCard className="w-3 h-3" />}
                              </div>
                              <span className="text-slate-600 truncate">
                                {card.program}
                                {card.owner !== 'me' && (
                                  <span className="text-purple-500 ml-1 text-xs">({card.owner})</span>
                                )}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-slate-900 font-medium">{toUse.toLocaleString()}</span>
                              <button
                                type="button"
                                onClick={() => removeCreditCard(card.id)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-50 rounded transition-opacity"
                                title="Remove"
                              >
                                <X className="w-3 h-3 text-red-500" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-sm text-slate-600">Total to use</span>
                      <span className="text-xl font-bold text-blue-600">{totalPointsToUse.toLocaleString()}</span>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center mx-auto mb-3">
                      <CreditCard className="w-6 h-6 text-blue-400" />
                    </div>
                    <p className="text-sm text-slate-600 mb-1">No points added yet</p>
                    <p className="text-xs text-slate-400 mb-4">Add your loyalty programs to find better deals</p>
                    <button
                      type="button"
                      onClick={() => setShowAddPointsModal(true)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors font-medium"
                    >
                      Add Your Points
                    </button>
                  </div>
                )}

                {/* Quick-add popular programs (show when unselected programs remain) */}
                {QUICK_ADD_PROGRAMS.some(name => !creditCards.some(c => c.program === name)) && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <p className="text-xs text-slate-500 mb-2 font-medium">Quick Add</p>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_ADD_PROGRAMS.filter(name => !creditCards.some(c => c.program === name)).slice(0, 4).map(programName => {
                        const programInfo = ALL_LOYALTY_PROGRAMS.find(p => p.value === programName || p.label === programName);
                        if (!programInfo) return null;
                        return (
                          <button
                            key={programInfo.value}
                            type="button"
                            onClick={() => {
                              setNewProgram(programInfo.value);
                              setNewCategory(programInfo.category === 'hotel' ? 'credit' : programInfo.category);
                              setShowAddPointsModal(true);
                            }}
                            className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-all"
                          >
                            {programInfo.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={startAirports.length === 0 || (!isRoundTrip && endAirports.length === 0) || (isRoundTrip && cities.length < 1) || (!isFlexible && (!startDate || (isRoundTrip && !endDate))) || maxBudget === '' || isGenerating}
                className="w-full px-6 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-base font-semibold shadow-lg shadow-blue-500/20"
              >
                {isGenerating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>{isEditMode ? 'Updating & searching...' : 'Searching flights...'}</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-5 h-5" />
                    <span>{isEditMode ? 'Update & Re-search' : 'Search Flights'}</span>
                  </>
                )}
              </button>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                  {error}
                </div>
              )}
              
              <p className="text-xs text-slate-500 text-center">
                We&apos;ll find the best options using your points and budget
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Points Allocation Modal */}
      {showPointsAllocationModal && creditCards.length > 0 && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowPointsAllocationModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200 flex-shrink-0">
              <h2 className="text-xl font-bold text-slate-900">Allocate points for this trip</h2>
              <p className="text-sm text-slate-600 mt-1">Choose how many points to use from each card. Default is use all.</p>
            </div>
            <div className="overflow-y-auto flex-1 p-6">
              <PointsAllocation
                availablePoints={creditCards.map(c => ({
                  program: c.owner !== 'me' ? `${c.program} (${c.owner})` : c.program,
                  points: c.points,
                  id: c.id,
                }))}
                allocatedPoints={Object.fromEntries(creditCards.map(c => [
                  c.owner !== 'me' ? `${c.program} (${c.owner})` : c.program,
                  pointsToUse[c.id] ?? c.points,
                ]))}
                onAllocationChange={(allocations) => {
                  // Convert program-keyed allocations back to id-keyed
                  const idKeyed: Record<string, number> = {};
                  creditCards.forEach(c => {
                    const key = c.owner !== 'me' ? `${c.program} (${c.owner})` : c.program;
                    if (key in allocations) {
                      idKeyed[c.id] = allocations[key];
                    }
                  });
                  setPointsToUse(idKeyed);
                }}
                maxTotalPoints={estimatedPoints > 0 ? estimatedPoints : undefined}
                showCategoryIcons
              />
            </div>
            <div className="p-6 border-t border-slate-200 flex-shrink-0">
              <button
                type="button"
                onClick={() => setShowPointsAllocationModal(false)}
                className="w-full py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Points Modal */}
      {showAddPointsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => {
          setShowAddPointsModal(false);
          setNewProgram('');
          setNewPoints('');
          setNewCategory('credit');
          setNewCardProduct('');
          setNewOwnerType('me');
          setNewOwnerName('');
          setShowOwnerDropdown(false);
          setProgramSearchQuery('');
          setShowProgramDropdown(false);
        }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] flex flex-col animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
            {/* Fixed header */}
            <div className="p-6 pb-4 border-b border-slate-200 flex-shrink-0">
              <div className="flex items-center justify-between">
                <h2 className="text-xl text-slate-900 font-semibold">Add Loyalty Program</h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddPointsModal(false);
                    setNewProgram('');
                    setNewPoints('');
                    setNewCategory('credit');
                    setNewCardProduct('');
                    setNewOwnerType('me');
                    setNewOwnerName('');
                    setShowOwnerDropdown(false);
                    setProgramSearchQuery('');
                    setShowProgramDropdown(false);
                  }}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-slate-600" />
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 p-6">
              <div className="space-y-5">
                {/* Whose Points? */}
                <div>
                  <label className="block text-sm text-slate-600 mb-2 font-medium">Whose points?</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => { setNewOwnerType('me'); setNewOwnerName(''); setShowOwnerDropdown(false); }}
                      className={`px-4 py-3 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                        newOwnerType === 'me'
                          ? 'border-blue-600 bg-blue-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <User className={`w-5 h-5 ${newOwnerType === 'me' ? 'text-blue-600' : 'text-slate-600'}`} />
                      <span className={`text-xs font-medium ${newOwnerType === 'me' ? 'text-blue-600' : 'text-slate-600'}`}>Mine</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewOwnerType('other')}
                      className={`px-4 py-3 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                        newOwnerType === 'other'
                          ? 'border-purple-600 bg-purple-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <Users className={`w-5 h-5 ${newOwnerType === 'other' ? 'text-purple-600' : 'text-slate-600'}`} />
                      <span className={`text-xs font-medium ${newOwnerType === 'other' ? 'text-purple-600' : 'text-slate-600'}`}>Someone else</span>
                    </button>
                  </div>
                  {newOwnerType === 'other' && (
                    <div className="mt-3">
                      <div className="relative" data-owner-dropdown>
                        <input
                          type="text"
                          value={newOwnerName}
                          onChange={(e) => {
                            setNewOwnerName(e.target.value);
                            setShowOwnerDropdown(true);
                          }}
                          onFocus={() => setShowOwnerDropdown(true)}
                          placeholder={existingOwnerNames.length > 0 ? 'Select or type a name...' : 'e.g., Sarah, Mom, John'}
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent pr-10"
                        />
                        {existingOwnerNames.length > 0 && (
                          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                        )}

                        {showOwnerDropdown && existingOwnerNames.length > 0 && (
                          <div
                            className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto"
                            onMouseDown={(e) => e.preventDefault()}
                          >
                            {existingOwnerNames
                              .filter(name => !newOwnerName || name.toLowerCase().includes(newOwnerName.toLowerCase()))
                              .map(name => (
                              <button
                                key={name}
                                type="button"
                                onClick={() => {
                                  setNewOwnerName(name);
                                  setShowOwnerDropdown(false);
                                }}
                                className="w-full px-4 py-3 text-left hover:bg-purple-50 transition-colors border-b border-slate-100 last:border-b-0 flex items-center gap-3"
                              >
                                <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-purple-50 text-purple-600">
                                  <User className="w-3 h-3" />
                                </div>
                                <span className="text-sm font-medium text-slate-900">{name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {existingOwnerNames.length > 0
                          ? 'Select an existing person or type a new name'
                          : 'Points from different people are kept separate and cannot be combined'}
                      </p>
                    </div>
                  )}
                </div>

                {/* Category Toggle */}
                <div>
                  <label className="block text-sm text-slate-600 mb-2 font-medium">Category</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'credit', label: 'Credit Card', icon: CreditCard },
                      { value: 'airline', label: 'Airline', icon: Plane },
                    ].map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setNewCategory(value as 'credit' | 'airline');
                          setNewProgram('');
                          setProgramSearchQuery('');
                        }}
                        className={`px-4 py-3 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                          newCategory === value
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <Icon className={`w-5 h-5 ${newCategory === value ? 'text-blue-600' : 'text-slate-600'}`} />
                        <span className={`text-xs font-medium ${newCategory === value ? 'text-blue-600' : 'text-slate-600'}`}>
                          {label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Program Dropdown */}
                <div className="relative">
                  <label className="block text-sm text-slate-600 mb-2 font-medium">
                    Program Name <span className="text-red-500">*</span>
                  </label>
                  <div className="relative" data-program-dropdown>
                    <input
                      type="text"
                      data-program-input
                      value={programSearchQuery || newProgram}
                      onChange={(e) => {
                        setProgramSearchQuery(e.target.value);
                        setShowProgramDropdown(true);
                        if (e.target.value !== newProgram) {
                          setNewProgram('');
                        }
                        const match = ALL_LOYALTY_PROGRAMS.find(
                          p => p.category === newCategory &&
                          (p.label.toLowerCase() === e.target.value.toLowerCase() ||
                           p.value.toLowerCase() === e.target.value.toLowerCase())
                        );
                        if (match) {
                          handleProgramSelect(match.value);
                        }
                      }}
                      onFocus={() => setShowProgramDropdown(true)}
                      placeholder="Search or select a program..."
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent pr-10"
                    />
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />

                    {showProgramDropdown && filteredPrograms.length > 0 && (
                      <div
                        className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto"
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        {filteredPrograms.map(program => (
                          <button
                            key={program.value}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleProgramSelect(program.value);
                            }}
                            className="w-full px-4 py-3 text-left hover:bg-blue-50 transition-colors border-b border-slate-100 last:border-b-0 flex items-center gap-3"
                          >
                            <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${getCategoryColor(program.category)}`}>
                              {program.category === 'airline' ? <Plane className="w-3 h-3" /> : <CreditCard className="w-3 h-3" />}
                            </div>
                            <span className="text-sm font-medium text-slate-900">{program.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {newProgram && !isValidProgram(newProgram) && (
                    <p className="text-xs text-red-500 mt-1">Please select a valid program from the list</p>
                  )}
                </div>

                {/* Points Balance */}
                <div>
                  <label className="block text-sm text-slate-600 mb-2 font-medium">Points Balance</label>
                  <input
                    type="number"
                    value={newPoints}
                    onChange={(e) => setNewPoints(e.target.value)}
                    onWheel={(e) => e.currentTarget.blur()}
                    placeholder="e.g., 150000"
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                  />
                </div>

                {/* Card Product (Optional) */}
                <div>
                  <label className="block text-sm text-slate-600 mb-2 font-medium">
                    Card product <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={newCardProduct}
                    onChange={(e) => setNewCardProduct(e.target.value)}
                    placeholder="e.g., Delta SkyMiles Gold Amex"
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Enables benefit-aware savings (e.g. free bags on Delta when you have Delta Gold)
                  </p>
                </div>
              </div>
            </div>

            {/* Fixed footer */}
            <div className="p-6 pt-4 border-t border-slate-200 flex-shrink-0">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddPointsModal(false);
                    setNewProgram('');
                    setNewPoints('');
                    setNewCategory('credit');
                    setNewCardProduct('');
                    setNewOwnerType('me');
                    setNewOwnerName('');
                    setShowOwnerDropdown(false);
                    setProgramSearchQuery('');
                    setShowProgramDropdown(false);
                  }}
                  className="flex-1 px-4 py-3 bg-white border-2 border-slate-200 text-slate-900 rounded-xl hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={addPointsCard}
                  disabled={!newProgram.trim() || !newPoints.trim() || !isValidProgram(newProgram) || (newOwnerType === 'other' && !newOwnerName.trim())}
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add Program
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SoloTripSetup() {
  return (
    <Suspense fallback={<div className="min-h-full flex items-center justify-center p-8 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50"><div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>}>
      <SoloTripSetupContent />
    </Suspense>
  );
}
