/**
 * Comprehensive list of all supported loyalty programs
 * This enum ensures data consistency and proper handling of transfers/conversions
 */

export enum LoyaltyProgram {
  // Credit Card Programs
  CHASE_ULTIMATE_REWARDS = 'Chase Ultimate Rewards',
  AMEX_MEMBERSHIP_REWARDS = 'Amex Membership Rewards',
  CITI_THANKYOU_POINTS = 'Citi ThankYou Points',
  CAPITAL_ONE_MILES = 'Capital One Miles',
  DISCOVER_MILES = 'Discover Miles',
  BANK_OF_AMERICA_POINTS = 'Bank of America Points',
  US_BANK_REWARDS = 'US Bank Rewards',
  WELLS_FARGO_POINTS = 'Wells Fargo Points',

  // Hotel Programs
  MARRIOTT_BONVOY = 'Marriott Bonvoy',
  HILTON_HONORS = 'Hilton Honors',
  HYATT_WORLD_OF_HYATT = 'Hyatt World of Hyatt',
  IHG_REWARDS = 'IHG Rewards',
  RADISSON_REWARDS = 'Radisson Rewards',
  WYNDHAM_REWARDS = 'Wyndham Rewards',
  CHOICE_PRIVILEGES = 'Choice Privileges',
  BEST_WESTERN_REWARDS = 'Best Western Rewards',
  ACCOR_LIVE_LIMITLESS = 'Accor Live Limitless',
  MGM_REWARDS = 'MGM Rewards',
  CAESARS_REWARDS = 'Caesars Rewards',

  // Airline Programs (US)
  DELTA_SKYMILES = 'Delta SkyMiles',
  UNITED_MILEAGEPLUS = 'United MileagePlus',
  AMERICAN_AIRLINES_AADVANTAGE = 'American Airlines AAdvantage',
  SOUTHWEST_RAPID_REWARDS = 'Southwest Rapid Rewards',
  ALASKA_MILEAGE_PLAN = 'Alaska Mileage Plan',
  JETBLUE_TRUEBLUE = 'JetBlue TrueBlue',
  SPIRIT_FREESPIRIT = 'Spirit FreeSpirit',
  FRONTIER_MILES = 'Frontier Miles',
  HAWAIIAN_MILES = 'Hawaiian Miles',

  // Airline Programs (International - Major)
  BRITISH_AIRWAYS_AVIOS = 'British Airways Avios',
  AIR_FRANCE_KLM_FLYING_BLUE = 'Air France-KLM Flying Blue',
  LUFTHANSA_MILES_MORE = 'Lufthansa Miles & More',
  AEROPLAN = 'Aeroplan',
  AVIANCA_LIFEMILES = 'Avianca LifeMiles',
  SINGAPORE_AIRLINES_KRISFLYER = 'Singapore Airlines KrisFlyer',
  QANTAS_FREQUENT_FLYER = 'Qantas Frequent Flyer',
  EMIRATES_SKYWARDS = 'Emirates Skywards',
  CATHAY_PACIFIC_ASIA_MILES = 'Cathay Pacific Asia Miles',
  JAPAN_AIRLINES_MILEAGE_BANK = 'Japan Airlines Mileage Bank',
  ALL_NIPPON_AIRWAYS_MILEAGE_CLUB = 'All Nippon Airways Mileage Club',
  KOREAN_AIR_SKYPASS = 'Korean Air Skypass',
  ASIANA_CLUB = 'Asiana Club',
  VIRGIN_ATLANTIC_FLYING_CLUB = 'Virgin Atlantic Flying Club',
  VIRGIN_AUSTRALIA_VELOCITY = 'Virgin Australia Velocity',
  QATAR_PRIVILEGE_CLUB = 'Qatar Privilege Club',
  ETIHAD_GUEST = 'Etihad Guest',
  TURKISH_AIRLINES_MILES_SMILES = 'Turkish Airlines Miles&Smiles',
}

export type ProgramCategory = 'credit' | 'hotel' | 'airline';

export interface LoyaltyProgramInfo {
  value: LoyaltyProgram;
  label: string;
  category: ProgramCategory;
}

/**
 * Complete list of all loyalty programs with their categories
 */
export const ALL_LOYALTY_PROGRAMS: LoyaltyProgramInfo[] = [
  // Credit Card Programs
  { value: LoyaltyProgram.CHASE_ULTIMATE_REWARDS, label: 'Chase Ultimate Rewards', category: 'credit' },
  { value: LoyaltyProgram.AMEX_MEMBERSHIP_REWARDS, label: 'Amex Membership Rewards', category: 'credit' },
  { value: LoyaltyProgram.CITI_THANKYOU_POINTS, label: 'Citi ThankYou Points', category: 'credit' },
  { value: LoyaltyProgram.CAPITAL_ONE_MILES, label: 'Capital One Miles', category: 'credit' },
  { value: LoyaltyProgram.DISCOVER_MILES, label: 'Discover Miles', category: 'credit' },
  { value: LoyaltyProgram.BANK_OF_AMERICA_POINTS, label: 'Bank of America Points', category: 'credit' },
  { value: LoyaltyProgram.US_BANK_REWARDS, label: 'US Bank Rewards', category: 'credit' },
  { value: LoyaltyProgram.WELLS_FARGO_POINTS, label: 'Wells Fargo Points', category: 'credit' },

  // Hotel Programs
  { value: LoyaltyProgram.MARRIOTT_BONVOY, label: 'Marriott Bonvoy', category: 'hotel' },
  { value: LoyaltyProgram.HILTON_HONORS, label: 'Hilton Honors', category: 'hotel' },
  { value: LoyaltyProgram.HYATT_WORLD_OF_HYATT, label: 'Hyatt World of Hyatt', category: 'hotel' },
  { value: LoyaltyProgram.IHG_REWARDS, label: 'IHG Rewards', category: 'hotel' },
  { value: LoyaltyProgram.RADISSON_REWARDS, label: 'Radisson Rewards', category: 'hotel' },
  { value: LoyaltyProgram.WYNDHAM_REWARDS, label: 'Wyndham Rewards', category: 'hotel' },
  { value: LoyaltyProgram.CHOICE_PRIVILEGES, label: 'Choice Privileges', category: 'hotel' },
  { value: LoyaltyProgram.BEST_WESTERN_REWARDS, label: 'Best Western Rewards', category: 'hotel' },
  { value: LoyaltyProgram.ACCOR_LIVE_LIMITLESS, label: 'Accor Live Limitless', category: 'hotel' },
  { value: LoyaltyProgram.MGM_REWARDS, label: 'MGM Rewards', category: 'hotel' },
  { value: LoyaltyProgram.CAESARS_REWARDS, label: 'Caesars Rewards', category: 'hotel' },

  // Airline Programs (US)
  { value: LoyaltyProgram.DELTA_SKYMILES, label: 'Delta SkyMiles', category: 'airline' },
  { value: LoyaltyProgram.UNITED_MILEAGEPLUS, label: 'United MileagePlus', category: 'airline' },
  { value: LoyaltyProgram.AMERICAN_AIRLINES_AADVANTAGE, label: 'American Airlines AAdvantage', category: 'airline' },
  { value: LoyaltyProgram.SOUTHWEST_RAPID_REWARDS, label: 'Southwest Rapid Rewards', category: 'airline' },
  { value: LoyaltyProgram.ALASKA_MILEAGE_PLAN, label: 'Alaska Mileage Plan', category: 'airline' },
  { value: LoyaltyProgram.JETBLUE_TRUEBLUE, label: 'JetBlue TrueBlue', category: 'airline' },
  { value: LoyaltyProgram.SPIRIT_FREESPIRIT, label: 'Spirit FreeSpirit', category: 'airline' },
  { value: LoyaltyProgram.FRONTIER_MILES, label: 'Frontier Miles', category: 'airline' },
  { value: LoyaltyProgram.HAWAIIAN_MILES, label: 'Hawaiian Miles', category: 'airline' },

  // Airline Programs (International)
  { value: LoyaltyProgram.BRITISH_AIRWAYS_AVIOS, label: 'British Airways Avios', category: 'airline' },
  { value: LoyaltyProgram.AIR_FRANCE_KLM_FLYING_BLUE, label: 'Air France-KLM Flying Blue', category: 'airline' },
  { value: LoyaltyProgram.LUFTHANSA_MILES_MORE, label: 'Lufthansa Miles & More', category: 'airline' },
  { value: LoyaltyProgram.AEROPLAN, label: 'Aeroplan', category: 'airline' },
  { value: LoyaltyProgram.AVIANCA_LIFEMILES, label: 'Avianca LifeMiles', category: 'airline' },
  { value: LoyaltyProgram.SINGAPORE_AIRLINES_KRISFLYER, label: 'Singapore Airlines KrisFlyer', category: 'airline' },
  { value: LoyaltyProgram.QANTAS_FREQUENT_FLYER, label: 'Qantas Frequent Flyer', category: 'airline' },
  { value: LoyaltyProgram.EMIRATES_SKYWARDS, label: 'Emirates Skywards', category: 'airline' },
  { value: LoyaltyProgram.CATHAY_PACIFIC_ASIA_MILES, label: 'Cathay Pacific Asia Miles', category: 'airline' },
  { value: LoyaltyProgram.JAPAN_AIRLINES_MILEAGE_BANK, label: 'Japan Airlines Mileage Bank', category: 'airline' },
  { value: LoyaltyProgram.ALL_NIPPON_AIRWAYS_MILEAGE_CLUB, label: 'All Nippon Airways Mileage Club', category: 'airline' },
  { value: LoyaltyProgram.KOREAN_AIR_SKYPASS, label: 'Korean Air Skypass', category: 'airline' },
  { value: LoyaltyProgram.ASIANA_CLUB, label: 'Asiana Club', category: 'airline' },
  { value: LoyaltyProgram.VIRGIN_ATLANTIC_FLYING_CLUB, label: 'Virgin Atlantic Flying Club', category: 'airline' },
  { value: LoyaltyProgram.VIRGIN_AUSTRALIA_VELOCITY, label: 'Virgin Australia Velocity', category: 'airline' },
  { value: LoyaltyProgram.QATAR_PRIVILEGE_CLUB, label: 'Qatar Privilege Club', category: 'airline' },
  { value: LoyaltyProgram.ETIHAD_GUEST, label: 'Etihad Guest', category: 'airline' },
  { value: LoyaltyProgram.TURKISH_AIRLINES_MILES_SMILES, label: 'Turkish Airlines Miles&Smiles', category: 'airline' },
];

/**
 * Get programs by category
 */
export function getProgramsByCategory(category: ProgramCategory): LoyaltyProgramInfo[] {
  return ALL_LOYALTY_PROGRAMS.filter(p => p.category === category);
}

/**
 * Get program info by value
 */
export function getProgramInfo(program: string): LoyaltyProgramInfo | undefined {
  return ALL_LOYALTY_PROGRAMS.find(p => p.value === program || p.label === program);
}

/**
 * Check if a program string is valid
 */
export function isValidProgram(program: string): boolean {
  return ALL_LOYALTY_PROGRAMS.some(p => p.value === program || p.label === program);
}

/**
 * Get category for a program
 */
export function getProgramCategory(program: string): ProgramCategory | undefined {
  const info = getProgramInfo(program);
  return info?.category;
}
