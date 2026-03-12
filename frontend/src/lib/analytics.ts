import { AwsRum } from 'aws-rum-web';

const RUM_APP_MONITOR_ID = process.env.NEXT_PUBLIC_RUM_APP_MONITOR_ID;
const RUM_IDENTITY_POOL_ID = process.env.NEXT_PUBLIC_RUM_IDENTITY_POOL_ID;
const RUM_REGION = process.env.NEXT_PUBLIC_RUM_REGION || 'us-east-1';
const ANALYTICS_ENABLED = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true';
const IS_BROWSER = typeof window !== 'undefined';
const IS_DEV = process.env.NODE_ENV === 'development';

const PII_DENYLIST = new Set([
  'email', 'name', 'first_name', 'last_name', 'phone',
  'password', 'card_number', 'ssn', 'passport',
]);

const SESSION_KEYS = {
  LANDING_PAGE: 'tripy_landing_page',
  INITIAL_REFERRER: 'tripy_initial_referrer',
  INITIAL_UTM_SOURCE: 'tripy_initial_utm_source',
  INITIAL_UTM_MEDIUM: 'tripy_initial_utm_medium',
  INITIAL_UTM_CAMPAIGN: 'tripy_initial_utm_campaign',
  INITIAL_UTM_TERM: 'tripy_initial_utm_term',
  INITIAL_UTM_CONTENT: 'tripy_initial_utm_content',
} as const;

let rum: AwsRum | null = null;

function initRum(): void {
  if (rum || !IS_BROWSER) return;

  const dnt = navigator.doNotTrack === '1';
  if (!ANALYTICS_ENABLED || !RUM_APP_MONITOR_ID || !RUM_IDENTITY_POOL_ID || dnt) {
    if (IS_DEV) {
      if (!RUM_APP_MONITOR_ID) console.warn('[Analytics] NEXT_PUBLIC_RUM_APP_MONITOR_ID missing — tracking disabled');
      if (!RUM_IDENTITY_POOL_ID) console.warn('[Analytics] NEXT_PUBLIC_RUM_IDENTITY_POOL_ID missing — tracking disabled');
      if (dnt) console.warn('[Analytics] Do Not Track enabled — tracking disabled');
      if (!ANALYTICS_ENABLED) console.warn('[Analytics] NEXT_PUBLIC_ANALYTICS_ENABLED is not true — tracking disabled');
    }
    return;
  }

  try {
    rum = new AwsRum(
      RUM_APP_MONITOR_ID,
      process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0',
      RUM_REGION,
      {
        sessionSampleRate: 1,
        identityPoolId: RUM_IDENTITY_POOL_ID,
        endpoint: `https://dataplane.rum.${RUM_REGION}.amazonaws.com`,
        telemetries: ['performance', 'errors', 'http'],
        allowCookies: true,
        enableXRay: false,
        pageIdFormat: 'PATH',
        disableAutoPageView: true,
      },
    );
  } catch (err) {
    console.error('[Analytics] CloudWatch RUM init failed:', err);
  }
}

if (IS_BROWSER) {
  initRum();
}

// ---------------------------------------------------------------------------
// Session attribution — captured once per tab session via sessionStorage
// ---------------------------------------------------------------------------

function captureSessionAttribution(): void {
  if (!IS_BROWSER) return;
  if (sessionStorage.getItem(SESSION_KEYS.LANDING_PAGE)) return;

  sessionStorage.setItem(SESSION_KEYS.LANDING_PAGE, window.location.pathname);
  sessionStorage.setItem(SESSION_KEYS.INITIAL_REFERRER, document.referrer || '');

  const params = new URLSearchParams(window.location.search);
  const utmKeys: Array<[string, string]> = [
    ['utm_source', SESSION_KEYS.INITIAL_UTM_SOURCE],
    ['utm_medium', SESSION_KEYS.INITIAL_UTM_MEDIUM],
    ['utm_campaign', SESSION_KEYS.INITIAL_UTM_CAMPAIGN],
    ['utm_term', SESSION_KEYS.INITIAL_UTM_TERM],
    ['utm_content', SESSION_KEYS.INITIAL_UTM_CONTENT],
  ];
  for (const [param, key] of utmKeys) {
    const val = params.get(param);
    if (val) sessionStorage.setItem(key, val);
  }
}

if (IS_BROWSER) {
  captureSessionAttribution();
}

function getSessionAttribution(): Record<string, string> {
  if (!IS_BROWSER) return {};
  const attrs: Record<string, string> = {};
  const landing = sessionStorage.getItem(SESSION_KEYS.LANDING_PAGE);
  if (landing) attrs.landing_page = landing;
  const ref = sessionStorage.getItem(SESSION_KEYS.INITIAL_REFERRER);
  if (ref) attrs.initial_referrer = ref;

  const map: Array<[string, string]> = [
    [SESSION_KEYS.INITIAL_UTM_SOURCE, 'initial_utm_source'],
    [SESSION_KEYS.INITIAL_UTM_MEDIUM, 'initial_utm_medium'],
    [SESSION_KEYS.INITIAL_UTM_CAMPAIGN, 'initial_utm_campaign'],
    [SESSION_KEYS.INITIAL_UTM_TERM, 'initial_utm_term'],
    [SESSION_KEYS.INITIAL_UTM_CONTENT, 'initial_utm_content'],
  ];
  for (const [storageKey, propName] of map) {
    const v = sessionStorage.getItem(storageKey);
    if (v) attrs[propName] = v;
  }
  return attrs;
}

// ---------------------------------------------------------------------------
// Base properties — auto-injected onto every event
// ---------------------------------------------------------------------------

function getBaseProperties(): Record<string, string> {
  if (!IS_BROWSER) return {};
  return {
    environment: process.env.NODE_ENV === 'production' ? 'prod' : IS_DEV ? 'dev' : 'staging',
    app_version: process.env.NEXT_PUBLIC_APP_VERSION || 'unknown',
    path: window.location.pathname,
    url: window.location.origin + window.location.pathname,
    ...(window.location.search ? { query_string: window.location.search } : {}),
    referrer: document.referrer || '',
    hostname: window.location.hostname,
  };
}

// ---------------------------------------------------------------------------
// Property sanitizer — enforces flat primitives, blocks PII
// ---------------------------------------------------------------------------

function sanitizeProperties(
  properties: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  if (!properties) return {};
  const clean: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (PII_DENYLIST.has(key.toLowerCase())) {
      if (IS_DEV) console.warn(`[Analytics] Blocked PII key "${key}" — dropped from event`);
      continue;
    }
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') {
      if (IS_DEV) console.warn(`[Analytics] Non-primitive value for "${key}" — dropped (only string/number/boolean allowed)`);
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value;
    }
  }
  return clean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function trackPageView(): void {
  const props = { ...getBaseProperties(), ...getSessionAttribution() };
  if (IS_DEV) console.log('[Analytics] page_viewed', props);
  if (!rum) return;
  try {
    rum.recordPageView(window.location.pathname);
    rum.recordEvent('page_viewed', props);
  } catch { /* analytics must never break the app */ }
}

export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  const sanitized = sanitizeProperties(properties);
  const props = { ...getBaseProperties(), ...getSessionAttribution(), ...sanitized };
  if (IS_DEV) console.log('[Analytics]', event, props);
  if (!rum) return;
  try {
    rum.recordEvent(event, props);
  } catch { /* analytics must never break the app */ }
}

export function identifyUser(internalUserId: string): void {
  if (IS_DEV) console.log('[Analytics] identify', internalUserId);
  if (!rum) return;
  try {
    rum.addSessionAttributes({ user_id: internalUserId });
  } catch { /* analytics must never break the app */ }
}

export function resetUser(): void {
  if (IS_DEV) console.log('[Analytics] reset');
  if (!rum) return;
  try {
    rum.addSessionAttributes({ user_id: '' });
  } catch { /* analytics must never break the app */ }
}

// ---------------------------------------------------------------------------
// Pre-defined event names for type safety (preserves backward compat)
// ---------------------------------------------------------------------------

export const EVENTS = {
  TRIP_GENERATED: 'trip_generated',
  TRIP_RESULT_VIEWED: 'trip_result_viewed',
  NO_SECOND_SEARCH: 'no_second_search',
  LOCK_PLAN_CLICKED: 'lock_plan_clicked',
  PLAN_LOCKED: 'plan_locked',
  SAVE_ACTION: 'save_action',
  CALMNESS_VOTE: 'calmness_vote',
  WHY_NOT_OTHERS_OPENED: 'why_not_others_opened',
  ADVANCED_DETAILS_TOGGLED: 'advanced_details_toggled',
  NEXT_STEPS_VIEWED: 'next_steps_viewed',
  SIGN_IN_PROMPTED: 'sign_in_prompted',
  SIGN_IN_COMPLETED: 'sign_in_completed',
  SIGN_IN_COMPLETED_FROM_PROMPT: 'sign_in_completed_from_prompt',
  CONTINUED_WITHOUT_SIGNING_IN: 'continued_without_signing_in',
  BOOKING_STEP_COMPLETED: 'booking_step_completed',
  BOOKING_STEP_VIEWED: 'booking_step_viewed',
  I_BOOKED_IT: 'i_booked_it',
  EMAIL_PLAN_REQUESTED: 'email_plan_requested',
  SHARED_LINK_OPENED: 'shared_link_opened',
  PLAN_CLAIMED: 'plan_claimed',
} as const;
