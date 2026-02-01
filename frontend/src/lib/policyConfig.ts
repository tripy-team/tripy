/**
 * Policy Configuration - Frontend mirror of backend policy settings.
 *
 * This file mirrors the backend policy reason codes, severities, and modes
 * so the frontend can properly render warnings, blocks, and handle acknowledgments.
 *
 * IMPORTANT: Keep in sync with backend/src/policy/reason_codes.py
 */

// =============================================================================
// REASON CODES
// =============================================================================

export const REASON_CODES = {
  // Flight connection codes
  FLIGHT_UNPROTECTED_CONNECTION: 'FLIGHT_UNPROTECTED_CONNECTION',
  FLIGHT_SELF_TRANSFER_RISK: 'FLIGHT_SELF_TRANSFER_RISK',
  FLIGHT_BELOW_MCT: 'FLIGHT_BELOW_MCT',
  FLIGHT_UNKNOWN_PROTECTION: 'FLIGHT_UNKNOWN_PROTECTION',
  FLIGHT_BASIC_ECONOMY_RESTRICTED: 'FLIGHT_BASIC_ECONOMY_RESTRICTED',
  FLIGHT_NONREFUNDABLE_RISK: 'FLIGHT_NONREFUNDABLE_RISK',
  FLIGHT_ROUNDTRIP_FLEX_RISK: 'FLIGHT_ROUNDTRIP_FLEX_RISK',
  FLIGHT_OVERNIGHT_CONNECTION: 'FLIGHT_OVERNIGHT_CONNECTION',
  FLIGHT_REDEYE_DEPARTURE: 'FLIGHT_REDEYE_DEPARTURE',
  FLIGHT_TIGHT_INTERNATIONAL_MCT: 'FLIGHT_TIGHT_INTERNATIONAL_MCT',
  FLIGHT_CODESHARE_DIFFERENT_TERMINAL: 'FLIGHT_CODESHARE_DIFFERENT_TERMINAL',
  FLIGHT_REGIONAL_JET: 'FLIGHT_REGIONAL_JET',
  FLIGHT_INVALID_TIMING: 'FLIGHT_INVALID_TIMING',

  // Hotel codes
  HOTEL_NONREFUNDABLE_RISK: 'HOTEL_NONREFUNDABLE_RISK',
  HOTEL_OTA_LOYALTY_LOSS: 'HOTEL_OTA_LOYALTY_LOSS',
  HOTEL_RESORT_FEES_PRESENT: 'HOTEL_RESORT_FEES_PRESENT',
  HOTEL_PREPAY_REQUIRED: 'HOTEL_PREPAY_REQUIRED',
  HOTEL_CANCELLATION_DEADLINE_SOON: 'HOTEL_CANCELLATION_DEADLINE_SOON',
  HOTEL_UNKNOWN_RATE_SOURCE: 'HOTEL_UNKNOWN_RATE_SOURCE',
  HOTEL_CITY_TAX_EXCLUDED: 'HOTEL_CITY_TAX_EXCLUDED',

  // Points/transfer codes
  POINTS_TRANSFER_IRREVERSIBLE: 'POINTS_TRANSFER_IRREVERSIBLE',
  POINTS_TRANSFER_INSTANT_ONLY: 'POINTS_TRANSFER_INSTANT_ONLY',
  POINTS_DEVALUATION_RISK: 'POINTS_DEVALUATION_RISK',
  POINTS_INSUFFICIENT_BALANCE: 'POINTS_INSUFFICIENT_BALANCE',

  // Global codes
  GLOBAL_REQUIRES_USER_ACK: 'GLOBAL_REQUIRES_USER_ACK',
  GLOBAL_DATA_STALE: 'GLOBAL_DATA_STALE',
  GLOBAL_PRICE_CHANGE_LIKELY: 'GLOBAL_PRICE_CHANGE_LIKELY',
} as const;

export type ReasonCode = typeof REASON_CODES[keyof typeof REASON_CODES];

// =============================================================================
// SEVERITY TYPES
// =============================================================================

export type PolicySeverity = 'info' | 'warn' | 'block';

export interface PolicyMessage {
  code: string;
  severity: PolicySeverity;
  title: string;
  detail: string;
  context: Record<string, unknown>;
  requires_ack: boolean;
  ack_text?: string;
}

export interface PolicyEvaluation {
  blocks: PolicyMessage[];
  warnings: PolicyMessage[];
  info: PolicyMessage[];
  requires_ack: string[];
  is_blocked: boolean;
  risk_score: number;
  explanations: string[];
}

// =============================================================================
// RISK MODES
// =============================================================================

export type RiskMode = 'safe' | 'balanced' | 'aggressive';

export const RISK_MODES: Record<
  RiskMode,
  {
    label: string;
    description: string;
    icon: string;
  }
> = {
  safe: {
    label: 'Safe',
    description: 'Only show protected, low-risk options',
    icon: '🛡️',
  },
  balanced: {
    label: 'Balanced',
    description: 'Show all options with warnings for risky ones',
    icon: '⚖️',
  },
  aggressive: {
    label: 'Aggressive',
    description: 'Show everything, just warn about risks',
    icon: '🚀',
  },
};

// =============================================================================
// DISPLAY HELPERS
// =============================================================================

/**
 * Get the display color for a severity level.
 */
export function getSeverityColor(severity: PolicySeverity): string {
  switch (severity) {
    case 'block':
      return 'red';
    case 'warn':
      return 'yellow';
    case 'info':
    default:
      return 'gray';
  }
}

/**
 * Get Tailwind classes for a severity level.
 */
export function getSeverityClasses(severity: PolicySeverity): {
  bg: string;
  text: string;
  border: string;
  icon: string;
} {
  switch (severity) {
    case 'block':
      return {
        bg: 'bg-red-50',
        text: 'text-red-800',
        border: 'border-red-200',
        icon: '🚫',
      };
    case 'warn':
      return {
        bg: 'bg-yellow-50',
        text: 'text-yellow-800',
        border: 'border-yellow-200',
        icon: '⚠️',
      };
    case 'info':
    default:
      return {
        bg: 'bg-gray-50',
        text: 'text-gray-700',
        border: 'border-gray-200',
        icon: 'ℹ️',
      };
  }
}

/**
 * Check if any messages require acknowledgment.
 */
export function requiresAcknowledgment(evaluation: PolicyEvaluation): boolean {
  return evaluation.requires_ack.length > 0;
}

/**
 * Check if all required codes have been acknowledged.
 */
export function isFullyAcknowledged(
  evaluation: PolicyEvaluation,
  acknowledgedCodes: string[]
): boolean {
  return evaluation.requires_ack.every((code) =>
    acknowledgedCodes.includes(code)
  );
}

/**
 * Get the codes that still need acknowledgment.
 */
export function getMissingAcknowledgments(
  evaluation: PolicyEvaluation,
  acknowledgedCodes: string[]
): string[] {
  return evaluation.requires_ack.filter(
    (code) => !acknowledgedCodes.includes(code)
  );
}

/**
 * Format a policy message for display.
 */
export function formatPolicyMessage(message: PolicyMessage): string {
  let text = `${message.title}: ${message.detail}`;

  // Add context details if relevant
  if (message.context) {
    const ctx = message.context as Record<string, unknown>;
    if (ctx.airport) {
      text = text.replace(/\{airport\}/g, String(ctx.airport));
    }
    if (ctx.layover_minutes) {
      text = text.replace(/\{minutes\}/g, String(ctx.layover_minutes));
    }
  }

  return text;
}

// =============================================================================
// CODE DESCRIPTIONS (for tooltips/help)
// =============================================================================

export const CODE_DESCRIPTIONS: Record<string, string> = {
  FLIGHT_UNPROTECTED_CONNECTION:
    'Your connection is on separate tickets. If you miss a connection, you may need to buy a new ticket.',
  FLIGHT_SELF_TRANSFER_RISK:
    'You must collect your bags and check in again at the connection. Allow extra time.',
  FLIGHT_BELOW_MCT:
    'Connection time is below the recommended minimum. You risk missing your connection.',
  FLIGHT_BASIC_ECONOMY_RESTRICTED:
    'Basic economy fares have restrictions: no changes, no seat selection, bags may cost extra.',
  HOTEL_NONREFUNDABLE_RISK:
    "This rate cannot be refunded if your plans change. Consider if it's worth the savings.",
  HOTEL_OTA_LOYALTY_LOSS:
    'Booking through a third party may not earn you points or elite benefits.',
  HOTEL_RESORT_FEES_PRESENT:
    'Mandatory fees are not included in the quoted price and will be charged at checkout.',
  POINTS_TRANSFER_IRREVERSIBLE:
    'Once you transfer points to an airline or hotel, you cannot transfer them back.',
};

/**
 * Get a human-readable description for a reason code.
 */
export function getCodeDescription(code: string): string {
  return CODE_DESCRIPTIONS[code] || 'Additional information about this option.';
}

// =============================================================================
// DEFAULT VALUES
// =============================================================================

export const DEFAULT_RISK_MODE: RiskMode = 'balanced';

export const EMPTY_POLICY_EVALUATION: PolicyEvaluation = {
  blocks: [],
  warnings: [],
  info: [],
  requires_ack: [],
  is_blocked: false,
  risk_score: 0,
  explanations: [],
};
