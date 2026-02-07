/**
 * Tripy Analytics — Track confidence signals (Task 17)
 * 
 * Tracks key user behaviors that indicate confidence:
 * - Trip generated → no second search (one-and-done)
 * - Lock plan clicks
 * - Save actions  
 * - Calmness votes
 */

interface AnalyticsEvent {
  event: string;
  properties?: Record<string, unknown>;
  timestamp: string;
}

// In-memory event buffer (for MVP; replace with real analytics in production)
const eventBuffer: AnalyticsEvent[] = [];

/**
 * Track an analytics event
 */
export function trackEvent(event: string, properties?: Record<string, unknown>) {
  const analyticsEvent: AnalyticsEvent = {
    event,
    properties: {
      ...properties,
      url: typeof window !== 'undefined' ? window.location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    },
    timestamp: new Date().toISOString(),
  };

  eventBuffer.push(analyticsEvent);

  // Log in development
  if (process.env.NODE_ENV === 'development') {
    console.log('[Analytics]', event, properties);
  }

  // Expose on window for debugging
  if (typeof window !== 'undefined') {
    (window as unknown as { tripyAnalytics?: { events: AnalyticsEvent[]; track: typeof trackEvent } }).tripyAnalytics = {
      events: eventBuffer,
      track: trackEvent,
    };
  }
}

// Pre-defined event names for type safety
export const EVENTS = {
  // Trip flow
  TRIP_GENERATED: 'trip_generated',
  TRIP_RESULT_VIEWED: 'trip_result_viewed',
  NO_SECOND_SEARCH: 'no_second_search', // User generated once and didn't search again
  
  // Confidence signals
  LOCK_PLAN_CLICKED: 'lock_plan_clicked',
  PLAN_LOCKED: 'plan_locked',
  SAVE_ACTION: 'save_action',
  
  // Feedback
  CALMNESS_VOTE: 'calmness_vote',
  
  // Engagement
  WHY_NOT_OTHERS_OPENED: 'why_not_others_opened',
  ADVANCED_DETAILS_TOGGLED: 'advanced_details_toggled',
  NEXT_STEPS_VIEWED: 'next_steps_viewed',
  
  // Auth
  SIGN_IN_PROMPTED: 'sign_in_prompted',
  SIGN_IN_COMPLETED_FROM_PROMPT: 'sign_in_completed_from_prompt',
  CONTINUED_WITHOUT_SIGNING_IN: 'continued_without_signing_in',

  // Booking loop (Phase 11)
  BOOKING_STEP_COMPLETED: 'booking_step_completed',
  I_BOOKED_IT: 'i_booked_it',

  // Share / Email (Phase 14)
  EMAIL_PLAN_REQUESTED: 'email_plan_requested',
  SHARED_LINK_OPENED: 'shared_link_opened',
  PLAN_CLAIMED: 'plan_claimed',
} as const;

/**
 * Get all buffered events (for debugging or batch sending)
 */
export function getEvents(): AnalyticsEvent[] {
  return [...eventBuffer];
}

/**
 * Clear the event buffer
 */
export function clearEvents(): void {
  eventBuffer.length = 0;
}
