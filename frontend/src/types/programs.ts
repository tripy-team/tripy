/**
 * Canonical Program IDs (Controlled Vocabulary)
 * 
 * These are the canonical program identifiers used across frontend, backend, and optimizer.
 * Never display raw IDs to users - use getProgramLabel() from programLabels.ts.
 */

export type PointsProgram =
  // Credit Card Programs (transferable currencies)
  | 'chase_ur'       // Chase Ultimate Rewards
  | 'amex_mr'        // Amex Membership Rewards
  | 'citi_typ'       // Citi ThankYou Points
  | 'capital_one'    // Capital One Miles
  | 'bilt'           // Bilt Rewards
  // Airline Programs
  | 'united'         // United MileagePlus
  | 'american'       // AAdvantage
  | 'delta'          // Delta SkyMiles
  | 'southwest'      // Southwest Rapid Rewards
  | 'jetblue'        // JetBlue TrueBlue
  | 'alaska'         // Alaska Mileage Plan
  | 'british_airways' // British Airways Avios
  | 'virgin_atlantic' // Virgin Atlantic Flying Club
  | 'air_france_klm' // Air France/KLM Flying Blue
  | 'singapore'      // Singapore KrisFlyer
  | 'ana'            // ANA Mileage Club
  // Hotel Programs
  | 'marriott'       // Marriott Bonvoy
  | 'hilton'         // Hilton Honors
  | 'hyatt'          // World of Hyatt
  | 'ihg';           // IHG One Rewards

/**
 * List of all valid program IDs for validation
 */
export const VALID_PROGRAMS: PointsProgram[] = [
  'chase_ur', 'amex_mr', 'citi_typ', 'capital_one', 'bilt',
  'united', 'american', 'delta', 'southwest', 'jetblue', 'alaska',
  'british_airways', 'virgin_atlantic', 'air_france_klm', 'singapore', 'ana',
  'marriott', 'hilton', 'hyatt', 'ihg',
];

/**
 * Check if a string is a valid program ID
 */
export function isValidProgram(program: string): program is PointsProgram {
  return VALID_PROGRAMS.includes(program as PointsProgram);
}
