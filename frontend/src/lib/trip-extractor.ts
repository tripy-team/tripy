/**
 * Trip Information Extractor
 * 
 * Extracts trip details from natural language input:
 * - Cities/locations
 * - Dates (start, end, duration, flexible)
 * - Budget (min/max)
 * - Credit card points
 */

export interface ExtractedTripInfo {
    cities: string[];
    startDestination?: string;
    endDestination?: string;
    startDate?: string;
    endDate?: string;
    duration?: number;
    isFlexible?: boolean;
    minBudget?: number;
    maxBudget?: number;
    creditCards?: Array<{ program: string; points: number }>;
    flightClass?: string;
    hotelClass?: string;
}

// Common city names for validation
const COMMON_CITIES = [
    'paris', 'london', 'tokyo', 'new york', 'sydney', 'rome', 'barcelona',
    'amsterdam', 'dubai', 'singapore', 'bangkok', 'istanbul', 'prague',
    'vienna', 'berlin', 'madrid', 'lisbon', 'athens', 'cairo', 'mumbai',
    'hong kong', 'seoul', 'beijing', 'shanghai', 'moscow', 'stockholm',
    'copenhagen', 'oslo', 'helsinki', 'dublin', 'edinburgh', 'brussels',
    'zurich', 'geneva', 'venice', 'florence', 'naples', 'milan', 'munich',
    'frankfurt', 'hamburg', 'cologne', 'warsaw', 'budapest', 'bucharest',
    'sofia', 'zagreb', 'belgrade', 'krakow', 'gdansk', 'porto', 'valencia',
    'sevilla', 'granada', 'bilbao', 'nice', 'lyon', 'marseille', 'bordeaux',
    'toulouse', 'strasbourg', 'nantes', 'lille', 'cannes', 'monaco', 'lucerne',
    'interlaken', 'zermatt', 'innsbruck', 'salzburg', 'hallstatt', 'santorini',
    'mykonos', 'crete', 'rhodes', 'corfu', 'dubrovnik', 'split', 'hvar',
    'kotor', 'sarajevo', 'mostar', 'ljubljana', 'lake bled', 'plitvice',
    'tallinn', 'riga', 'vilnius', 'reykjavik', 'tromso', 'bergen', 'stavanger',
    'gothenburg', 'malmo', 'aarhus', 'odense', 'tampere', 'turku', 'oulu',
    'reykjavik', 'akureyri', 'glasgow', 'manchester', 'liverpool', 'birmingham',
    'bristol', 'bath', 'york', 'cambridge', 'oxford', 'brighton', 'canterbury',
    'inverness', 'aberdeen', 'cardiff', 'swansea', 'belfast', 'cork', 'galway',
    'kilkenny', 'limerick', 'waterford', 'drogheda', 'wicklow', 'killarney',
    'dingle', 'westport', 'clifden', 'donegal', 'sligo', 'letterkenny',
    'bunratty', 'adare', 'kenmare', 'sneem', 'waterville', 'cahersiveen',
    'portmagee', 'valentia', 'dingle', 'tralee', 'listowel', 'ballybunion',
    'ballyheigue', 'fenit', 'castlegregory', 'annascaul', 'camp', 'castlemaine',
    'milltown', 'killorglin', 'glenbeigh', 'cahirciveen', 'ballinskelligs',
    'portmagee', 'valentia island', 'knightstown', 'portmagee', 'waterville',
    'cahersiveen', 'sneem', 'kenmare', 'killarney', 'tralee', 'listowel',
    'ballybunion', 'ballyheigue', 'fenit', 'castlegregory', 'annascaul',
    'camp', 'castlemaine', 'milltown', 'killorglin', 'glenbeigh', 'cahirciveen',
    'ballinskelligs', 'portmagee', 'valentia island', 'knightstown'
];

import { ALL_LOYALTY_PROGRAMS, LoyaltyProgram, getProgramInfo } from './loyalty-programs';

// Create a map of common aliases to enum values for matching
const PROGRAM_ALIASES: { [key: string]: string } = {
    // Credit cards
    'chase sapphire': LoyaltyProgram.CHASE_ULTIMATE_REWARDS,
    'chase ultimate rewards': LoyaltyProgram.CHASE_ULTIMATE_REWARDS,
    'amex platinum': LoyaltyProgram.AMEX_MEMBERSHIP_REWARDS,
    'amex gold': LoyaltyProgram.AMEX_MEMBERSHIP_REWARDS,
    'amex membership rewards': LoyaltyProgram.AMEX_MEMBERSHIP_REWARDS,
    'citi prestige': LoyaltyProgram.CITI_THANKYOU_POINTS,
    'citi thankyou': LoyaltyProgram.CITI_THANKYOU_POINTS,
    'capital one': LoyaltyProgram.CAPITAL_ONE_MILES,
    // Hotels
    'marriott': LoyaltyProgram.MARRIOTT_BONVOY,
    'marriott bonvoy': LoyaltyProgram.MARRIOTT_BONVOY,
    'hilton': LoyaltyProgram.HILTON_HONORS,
    'hilton honors': LoyaltyProgram.HILTON_HONORS,
    'hyatt': LoyaltyProgram.HYATT_WORLD_OF_HYATT,
    'ihg': LoyaltyProgram.IHG_REWARDS,
    // Airlines
    'united': LoyaltyProgram.UNITED_MILEAGEPLUS,
    'united mileageplus': LoyaltyProgram.UNITED_MILEAGEPLUS,
    'delta': LoyaltyProgram.DELTA_SKYMILES,
    'delta skymiles': LoyaltyProgram.DELTA_SKYMILES,
    'american airlines': LoyaltyProgram.AMERICAN_AIRLINES_AADVANTAGE,
    'aa advantage': LoyaltyProgram.AMERICAN_AIRLINES_AADVANTAGE,
    'southwest': LoyaltyProgram.SOUTHWEST_RAPID_REWARDS,
    'jetblue': LoyaltyProgram.JETBLUE_TRUEBLUE,
    'alaska': LoyaltyProgram.ALASKA_MILEAGE_PLAN,
    'british airways': LoyaltyProgram.BRITISH_AIRWAYS_AVIOS,
    'air france': LoyaltyProgram.AIR_FRANCE_KLM_FLYING_BLUE,
    'klm': LoyaltyProgram.AIR_FRANCE_KLM_FLYING_BLUE,
    'lufthansa': LoyaltyProgram.LUFTHANSA_MILES_MORE,
    'aeroplan': LoyaltyProgram.AEROPLAN,
    'singapore airlines': LoyaltyProgram.SINGAPORE_AIRLINES_KRISFLYER,
    'qantas': LoyaltyProgram.QANTAS_FREQUENT_FLYER,
    'emirates': LoyaltyProgram.EMIRATES_SKYWARDS,
    'cathay pacific': LoyaltyProgram.CATHAY_PACIFIC_ASIA_MILES,
    'ana': LoyaltyProgram.ALL_NIPPON_AIRWAYS_MILEAGE_CLUB,
    'jal': LoyaltyProgram.JAPAN_AIRLINES_MILEAGE_BANK,
    'virgin atlantic': LoyaltyProgram.VIRGIN_ATLANTIC_FLYING_CLUB,
};

// All valid program names (enum values + aliases)
const CREDIT_CARD_PROGRAMS = [
    ...ALL_LOYALTY_PROGRAMS.map(p => p.value),
    ...Object.keys(PROGRAM_ALIASES)
];

/**
 * Extract cities and start/end destinations from text
 */
function extractCities(text: string): { cities: string[]; startDestination?: string; endDestination?: string } {
    const cities: string[] = [];
    let startDestination: string | undefined;
    let endDestination: string | undefined;
    
    // Look for start/end destination patterns
    // "from New York to Paris" or "starting in New York, ending in London"
    const startEndPatterns = [
        /(?:from|starting in|start in|departing from|leaving from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:to|ending in|end in|arriving in|going to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
        /(?:from|starting|start|departing|leaving)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:to|ending|end|arriving|going to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
    ];
    
    for (const pattern of startEndPatterns) {
        const match = text.match(pattern);
        if (match) {
            const fullMatch = match[0];
            const startMatch = fullMatch.match(/(?:from|starting in|start in|departing from|leaving from|from|starting|start|departing|leaving)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
            const endMatch = fullMatch.match(/(?:to|ending in|end in|arriving in|going to|to|ending|end|arriving|going to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
            if (startMatch && startMatch[1]) {
                startDestination = startMatch[1].trim();
            }
            if (endMatch && endMatch[1]) {
                endDestination = endMatch[1].trim();
            }
            // Remove start/end destinations from text to avoid double extraction
            text = text.replace(pattern, '');
            break;
        }
    }
    
    // Look for common patterns for cities/destinations
    const patterns = [
        // "to Paris, London, and Tokyo"
        /(?:to|visit|going to|travel to|trip to|destinations?|cities?)[\s:]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)*)/gi,
        // "Paris and London"
        /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:and|&|,)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
        // "I want to go to Paris"
        /(?:want to|wanna|going to|visit|see)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
        // City names in quotes
        /"([^"]+)"/g,
        // City names after "in" or "at"
        /(?:in|at)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
    ];

    for (const pattern of patterns) {
        const matches = text.matchAll(pattern);
        for (const match of matches) {
            for (let i = 1; i < match.length; i++) {
                if (match[i]) {
                    const city = match[i].trim();
                    // Validate it's a reasonable city name (2+ chars, starts with capital)
                    if (city.length >= 2 && /^[A-Z]/.test(city)) {
                        // Don't add if it's already a start/end destination
                        if (city !== startDestination && city !== endDestination) {
                            cities.push(city);
                        }
                    }
                }
            }
        }
    }

    // Also check for common city names
    for (const city of COMMON_CITIES) {
        const regex = new RegExp(`\\b${city}\\b`, 'i');
        if (regex.test(text) && !cities.some(c => c.toLowerCase() === city)) {
            // Capitalize properly
            const capitalized = city.split(' ').map(w =>
                w.charAt(0).toUpperCase() + w.slice(1)
            ).join(' ');
            
            // Don't add if it's already a start/end destination
            if (capitalized !== startDestination && capitalized !== endDestination) {
                cities.push(capitalized);
            }
        }
    }

    // Remove duplicates and normalize
    const uniqueCities = Array.from(new Set(cities.map(c => c.trim())))
        .filter(c => c.length > 0);

    return {
        cities: uniqueCities,
        startDestination: startDestination?.trim(),
        endDestination: endDestination?.trim(),
    };
}

/**
 * Extract dates from text
 */
function extractDates(text: string): {
    startDate?: string;
    endDate?: string;
    duration?: number;
    isFlexible?: boolean;
} {
    const result: {
        startDate?: string;
        endDate?: string;
        duration?: number;
        isFlexible?: boolean;
    } = {};

    // Check for flexible dates
    if (/(flexible|anytime|whenever|open|no specific|don't care|doesn't matter).*date/i.test(text)) {
        result.isFlexible = true;
    }

    // Extract duration (e.g., "7 days", "2 weeks", "a month")
    const durationPatterns = [
        /(\d+)\s*(?:day|days)/i,
        /(\d+)\s*(?:week|weeks)/i,
        /(\d+)\s*(?:month|months)/i,
        /(?:a|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:day|week|month)/i,
    ];

    for (const pattern of durationPatterns) {
        const match = text.match(pattern);
        if (match) {
            const num = parseInt(match[1] || '1');
            if (pattern.source.includes('week')) {
                result.duration = num * 7;
            } else if (pattern.source.includes('month')) {
                result.duration = num * 30;
            } else {
                result.duration = num;
            }
            break;
        }
    }

    // Extract specific dates
    // Format: "from March 15 to March 22" or "March 15-22, 2024"
    const datePatterns = [
        // ISO format: "2024-03-15 to 2024-03-22" or "2024-03-15 - 2024-03-22"
        /(\d{4}-\d{2}-\d{2})\s+(?:to|-)\s+(\d{4}-\d{2}-\d{2})/i,
        // "from March 15 to March 22, 2024"
        /from\s+(\w+\s+\d+(?:,\s*\d{4})?)\s+to\s+(\w+\s+\d+(?:,\s*\d{4})?)/i,
        // "March 15-22, 2024"
        /(\w+\s+\d+)\s*-\s*(\d+)(?:,\s*(\d{4}))?/i,
        // "March 15, 2024 to March 22, 2024"
        /(\w+\s+\d+,\s*\d{4})\s+to\s+(\w+\s+\d+,\s*\d{4})/i,
        // "next week", "next month"
        /next\s+(week|month)/i,
        // "in March", "in April 2024"
        /in\s+(\w+)(?:\s+(\d{4}))?/i,
    ];

    for (const pattern of datePatterns) {
        const match = text.match(pattern);
        if (match) {
            try {
                if (match[0].includes('next week')) {
                    const start = new Date();
                    start.setDate(start.getDate() + 7);
                    const end = new Date(start);
                    end.setDate(end.getDate() + 7);
                    result.startDate = start.toISOString().split('T')[0];
                    result.endDate = end.toISOString().split('T')[0];
                    break;
                } else if (match[0].includes('next month')) {
                    const start = new Date();
                    start.setMonth(start.getMonth() + 1);
                    const end = new Date(start);
                    end.setDate(end.getDate() + 7);
                    result.startDate = start.toISOString().split('T')[0];
                    result.endDate = end.toISOString().split('T')[0];
                    break;
                } else if (match[0].includes('in ')) {
                    // "in March" or "in April 2024"
                    const monthName = match[1];
                    const year = match[2] ? parseInt(match[2]) : new Date().getFullYear();
                    const monthMap: Record<string, number> = {
                        january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
                        july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
                        jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
                    };
                    const month = monthMap[monthName.toLowerCase()];
                    if (month !== undefined) {
                        const start = new Date(year, month, 1);
                        const end = new Date(year, month + 1, 0); // Last day of month
                        result.startDate = start.toISOString().split('T')[0];
                        result.endDate = end.toISOString().split('T')[0];
                    }
                    break;
                } else if (match[1] && match[2]) {
                    const start = parseDate(match[1]);
                    const end = parseDate(match[2]);
                    if (start && end) {
                        // Ensure end is after start
                        if (end >= start) {
                            result.startDate = start.toISOString().split('T')[0];
                            result.endDate = end.toISOString().split('T')[0];
                            break;
                        }
                    }
                }
            } catch (_e) {
                // Ignore parsing errors, continue to next pattern
            }
        }
    }

    return result;
}

/**
 * Parse a date string to Date object
 */
function parseDate(dateStr: string): Date | null {
    try {
        const trimmed = dateStr.trim();

        // Try ISO format first (YYYY-MM-DD)
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            return new Date(trimmed);
        }

        // Try "March 15, 2024" or "March 15" format
        const parsed = new Date(trimmed);
        if (!isNaN(parsed.getTime())) {
            // Check if year is reasonable (not 1900s or far future)
            const year = parsed.getFullYear();
            if (year >= 2020 && year <= 2030) {
                return parsed;
            }
        }

        // Try "MM/DD/YYYY" or "MM-DD-YYYY"
        const slashMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (slashMatch) {
            const [, month, day, year] = slashMatch;
            return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Extract budget from text
 */
function extractBudget(text: string): { minBudget?: number; maxBudget?: number } {
    const result: { minBudget?: number; maxBudget?: number } = {};

    // Patterns: "$1000-$5000", "between $1000 and $5000", "around $3000"
    const patterns = [
        /\$(\d+(?:,\d{3})*)\s*[-–—]\s*\$(\d+(?:,\d{3})*)/i,
        /(?:between|from)\s+\$?(\d+(?:,\d{3})*)\s+(?:and|to)\s+\$?(\d+(?:,\d{3})*)/i,
        /(?:budget|spend|cost)\s+(?:of|is|around|about)?\s*\$?(\d+(?:,\d{3})*)/i,
        /\$(\d+(?:,\d{3})*)\s+(?:to|and)\s+\$(\d+(?:,\d{3})*)/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const num1 = parseInt(match[1].replace(/,/g, ''));
            const num2 = match[2] ? parseInt(match[2].replace(/,/g, '')) : num1;

            if (num1 && num2) {
                result.minBudget = Math.min(num1, num2);
                result.maxBudget = Math.max(num1, num2);
            } else if (num1) {
                // Single budget, use as max, estimate min as 50%
                result.minBudget = Math.floor(num1 * 0.5);
                result.maxBudget = num1;
            }
            break;
        }
    }

    return result;
}

/**
 * Extract credit card information
 */
function extractCreditCards(text: string): Array<{ program: string; points: number }> {
    const cards: Array<{ program: string; points: number }> = [];
    const foundPrograms = new Set<string>(); // Track found programs to avoid duplicates

    // Look for loyalty programs (all categories)
    for (const program of CREDIT_CARD_PROGRAMS) {
        const programLower = program.toLowerCase();
        const regex = new RegExp(`\\b${programLower.replace(/\s+/g, '\\s+')}\\b`, 'i');
        
        if (regex.test(text) && !foundPrograms.has(programLower)) {
            foundPrograms.add(programLower);
            
            // Try to find points amount nearby
            const pointsMatch = text.match(new RegExp(`${programLower}[^.]*?(\\d{1,3}(?:,\\d{3})*)\\s*(?:points?|pts)`, 'i'));
            const points = pointsMatch ? parseInt(pointsMatch[1].replace(/,/g, '')) : 0;

            // Map alias to enum value if needed
            const enumValue = PROGRAM_ALIASES[programLower] || program;
            const programInfo = getProgramInfo(enumValue);
            const finalProgram = programInfo?.value || enumValue;

            // Only add if it's a valid program
            if (getProgramInfo(finalProgram)) {
                cards.push({
                    program: finalProgram,
                    points: points || 0,
                });
            }
        }
    }

    return cards;
}

/**
 * Extract travel style preferences (flight class and hotel class)
 */
function extractTravelStyle(text: string): { flightClass?: string; hotelClass?: string } {
    const result: { flightClass?: string; hotelClass?: string } = {};

    // Flight class patterns
    const flightPatterns = [
        { pattern: /\b(basic\s*economy|basic\s*econ)\b/i, value: 'basic_economy' },
        { pattern: /\b(economy|coach)\b/i, value: 'economy' },
        { pattern: /\b(premium\s*economy|premium)\b/i, value: 'premium' },
        { pattern: /\b(business\s*class|business)\b/i, value: 'business' },
        { pattern: /\b(first\s*class|first)\b/i, value: 'first' },
    ];

    for (const { pattern, value } of flightPatterns) {
        if (pattern.test(text)) {
            result.flightClass = value;
            break;
        }
    }

    // Hotel class patterns
    const hotelPatterns = [
        { pattern: /\b(3\s*star|standard|budget)\b/i, value: '3' },
        { pattern: /\b(4\s*star|upscale|mid[- ]?range)\b/i, value: '4' },
        { pattern: /\b(5\s*star|luxury|high[- ]?end)\b/i, value: '5' },
    ];

    for (const { pattern, value } of hotelPatterns) {
        if (pattern.test(text)) {
            result.hotelClass = value;
            break;
        }
    }

    return result;
}

/**
 * Main extraction function
 */
export function extractTripInfo(text: string): ExtractedTripInfo {
    const cityData = extractCities(text);
    const dates = extractDates(text);
    const budget = extractBudget(text);
    const creditCards = extractCreditCards(text);
    const travelStyle = extractTravelStyle(text);

    return {
        cities: cityData.cities,
        startDestination: cityData.startDestination,
        endDestination: cityData.endDestination,
        ...dates,
        ...budget,
        creditCards: creditCards.length > 0 ? creditCards : undefined,
        ...travelStyle,
    };
}
