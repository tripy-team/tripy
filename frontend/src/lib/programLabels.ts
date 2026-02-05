/**
 * Program Display Labels
 * 
 * Maps canonical program IDs to human-readable display names.
 * UI should NEVER display raw IDs like "air_france_klm".
 */

import type { PointsProgram } from '@/types/programs';

/**
 * Display labels for canonical program IDs.
 * Use getProgramLabel() to safely get labels with fallback.
 */
export const PROGRAM_LABELS: Record<PointsProgram, string> = {
  // Credit Card Programs
  chase_ur: 'Chase Ultimate Rewards',
  amex_mr: 'Amex Membership Rewards',
  citi_typ: 'Citi ThankYou Points',
  capital_one: 'Capital One Miles',
  bilt: 'Bilt Rewards',
  
  // Airlines
  united: 'United MileagePlus',
  american: 'AAdvantage',
  delta: 'Delta SkyMiles',
  southwest: 'Southwest Rapid Rewards',
  jetblue: 'JetBlue TrueBlue',
  alaska: 'Alaska Mileage Plan',
  british_airways: 'British Airways Avios',
  virgin_atlantic: 'Virgin Atlantic Flying Club',
  air_france_klm: 'Air France/KLM Flying Blue',
  singapore: 'Singapore KrisFlyer',
  ana: 'ANA Mileage Club',
  
  // Hotels
  marriott: 'Marriott Bonvoy',
  hilton: 'Hilton Honors',
  hyatt: 'World of Hyatt',
  ihg: 'IHG One Rewards',
};

/**
 * Get the display label for a program ID.
 * Returns the raw ID if no label is found (with warning in dev).
 */
export function getProgramLabel(programId: string): string {
  const label = PROGRAM_LABELS[programId as PointsProgram];
  
  if (!label) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`Unknown program ID: ${programId}`);
    }
    return programId;
  }
  
  return label;
}

/**
 * Short labels for compact UI display
 */
export const PROGRAM_SHORT_LABELS: Record<PointsProgram, string> = {
  // Credit Card Programs
  chase_ur: 'Chase UR',
  amex_mr: 'Amex MR',
  citi_typ: 'Citi TYP',
  capital_one: 'Cap One',
  bilt: 'Bilt',
  
  // Airlines
  united: 'United',
  american: 'American',
  delta: 'Delta',
  southwest: 'Southwest',
  jetblue: 'JetBlue',
  alaska: 'Alaska',
  british_airways: 'BA Avios',
  virgin_atlantic: 'Virgin',
  air_france_klm: 'Flying Blue',
  singapore: 'KrisFlyer',
  ana: 'ANA',
  
  // Hotels
  marriott: 'Marriott',
  hilton: 'Hilton',
  hyatt: 'Hyatt',
  ihg: 'IHG',
};

/**
 * Get the short display label for a program ID.
 */
export function getProgramShortLabel(programId: string): string {
  const label = PROGRAM_SHORT_LABELS[programId as PointsProgram];
  return label || programId;
}

/**
 * Extended mapping for various program code formats (SNAKE_CASE, lowercase, etc.)
 * Maps various raw database formats to human-readable names.
 */
const EXTENDED_PROGRAM_LABELS: Record<string, string> = {
  // Credit Card Programs - various formats
  'CHASE_ULTIMATE_REWARDS': 'Chase Ultimate Rewards',
  'chase_ultimate_rewards': 'Chase Ultimate Rewards',
  'chase': 'Chase Ultimate Rewards',
  'Chase': 'Chase Ultimate Rewards',
  'AMEX_MEMBERSHIP_REWARDS': 'Amex Membership Rewards',
  'amex_membership_rewards': 'Amex Membership Rewards',
  'amex': 'Amex Membership Rewards',
  'Amex': 'Amex Membership Rewards',
  'CITI_THANKYOU_POINTS': 'Citi ThankYou Points',
  'citi_thankyou_points': 'Citi ThankYou Points',
  'citi': 'Citi ThankYou Points',
  'CAPITAL_ONE_MILES': 'Capital One Miles',
  'capital_one_miles': 'Capital One Miles',
  'capital_one': 'Capital One Miles',
  'BILT_REWARDS': 'Bilt Rewards',
  'bilt_rewards': 'Bilt Rewards',
  'bilt': 'Bilt Rewards',
  
  // Airline Programs - various formats
  'UNITED_MILEAGEPLUS': 'United MileagePlus',
  'united_mileageplus': 'United MileagePlus',
  'united': 'United MileagePlus',
  'UA': 'United MileagePlus',
  'AMERICAN_AADVANTAGE': 'American AAdvantage',
  'american_aadvantage': 'American AAdvantage',
  'american': 'American AAdvantage',
  'AA': 'American AAdvantage',
  'DELTA_SKYMILES': 'Delta SkyMiles',
  'delta_skymiles': 'Delta SkyMiles',
  'delta': 'Delta SkyMiles',
  'DL': 'Delta SkyMiles',
  'SOUTHWEST_RAPID_REWARDS': 'Southwest Rapid Rewards',
  'southwest_rapid_rewards': 'Southwest Rapid Rewards',
  'southwest': 'Southwest Rapid Rewards',
  'WN': 'Southwest Rapid Rewards',
  'JETBLUE_TRUEBLUE': 'JetBlue TrueBlue',
  'jetblue_trueblue': 'JetBlue TrueBlue',
  'jetblue': 'JetBlue TrueBlue',
  'B6': 'JetBlue TrueBlue',
  'ALASKA_MILEAGE_PLAN': 'Alaska Mileage Plan',
  'alaska_mileage_plan': 'Alaska Mileage Plan',
  'alaska': 'Alaska Mileage Plan',
  'AS': 'Alaska Mileage Plan',
  'BRITISH_AIRWAYS_AVIOS': 'British Airways Avios',
  'british_airways_avios': 'British Airways Avios',
  'british_airways': 'British Airways Avios',
  'BA': 'British Airways Avios',
  'VIRGIN_ATLANTIC_FLYING_CLUB': 'Virgin Atlantic Flying Club',
  'virgin_atlantic_flying_club': 'Virgin Atlantic Flying Club',
  'virgin_atlantic': 'Virgin Atlantic Flying Club',
  'VS': 'Virgin Atlantic Flying Club',
  'AIR_FRANCE_KLM_FLYING_BLUE': 'Air France-KLM Flying Blue',
  'air_france_klm_flying_blue': 'Air France-KLM Flying Blue',
  'air_france_klm': 'Air France-KLM Flying Blue',
  'flying_blue': 'Flying Blue',
  'AF': 'Air France-KLM Flying Blue',
  'KL': 'Air France-KLM Flying Blue',
  'SINGAPORE_KRISFLYER': 'Singapore KrisFlyer',
  'singapore_krisflyer': 'Singapore KrisFlyer',
  'singapore': 'Singapore KrisFlyer',
  'SQ': 'Singapore KrisFlyer',
  'ANA_MILEAGE_CLUB': 'ANA Mileage Club',
  'ana_mileage_club': 'ANA Mileage Club',
  'ana': 'ANA Mileage Club',
  'NH': 'ANA Mileage Club',
  'AEROPLAN': 'Aeroplan',
  'aeroplan': 'Aeroplan',
  'AC': 'Aeroplan',
  'AVIANCA_LIFEMILES': 'Avianca LifeMiles',
  'avianca_lifemiles': 'Avianca LifeMiles',
  'lifemiles': 'Avianca LifeMiles',
  'EMIRATES_SKYWARDS': 'Emirates Skywards',
  'emirates_skywards': 'Emirates Skywards',
  'emirates': 'Emirates Skywards',
  'EK': 'Emirates Skywards',
  
  // Hotel Programs - various formats
  'MARRIOTT_BONVOY': 'Marriott Bonvoy',
  'marriott_bonvoy': 'Marriott Bonvoy',
  'marriott': 'Marriott Bonvoy',
  'HILTON_HONORS': 'Hilton Honors',
  'hilton_honors': 'Hilton Honors',
  'hilton': 'Hilton Honors',
  'HYATT_WORLD_OF_HYATT': 'World of Hyatt',
  'hyatt_world_of_hyatt': 'World of Hyatt',
  'world_of_hyatt': 'World of Hyatt',
  'hyatt': 'World of Hyatt',
  'IHG_ONE_REWARDS': 'IHG One Rewards',
  'ihg_one_rewards': 'IHG One Rewards',
  'ihg': 'IHG One Rewards',
};

/**
 * Format a program name for display.
 * 
 * Handles various input formats:
 * - SNAKE_CASE: "CHASE_ULTIMATE_REWARDS" -> "Chase Ultimate Rewards"
 * - snake_case: "chase_ultimate_rewards" -> "Chase Ultimate Rewards"
 * - Known IDs: "chase_ur" -> "Chase Ultimate Rewards"
 * - Airline codes: "UA" -> "United MileagePlus"
 * - Unknown: Converts to title case without underscores
 * 
 * @param programId - The program identifier to format
 * @returns Human-readable program name
 */
export function formatProgramName(programId: string): string {
  if (!programId) return '';
  
  // Check extended mapping first (handles SNAKE_CASE and various formats)
  if (EXTENDED_PROGRAM_LABELS[programId]) {
    return EXTENDED_PROGRAM_LABELS[programId];
  }
  
  // Check the canonical program labels
  const canonicalLabel = PROGRAM_LABELS[programId as PointsProgram];
  if (canonicalLabel) {
    return canonicalLabel;
  }
  
  // For unknown programs, convert SNAKE_CASE/snake_case to Title Case
  // e.g., "SOME_NEW_PROGRAM" -> "Some New Program"
  return programId
    .toLowerCase()
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
