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
