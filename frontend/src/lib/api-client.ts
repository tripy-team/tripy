// Tripy B2B API Client
// Typed fetch wrapper for all backend endpoints

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface User {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  orgId: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ClientBalanceSummary {
  id: string;
  balance: number;
  expirationDate?: string | null;
  loyaltyProgram: { name: string; code: string; category: string };
}

export interface ClientTripSummary {
  id: string;
  title: string;
  destinationAirports: string[];
  departureDate: string;
  returnDate?: string;
  status: string;
}

export interface Client {
  id: string;
  orgId: string;
  clientType: 'individual' | 'business';
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dateOfBirth?: string;
  notes?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  _count?: { loyaltyBalances: number; familyMembers: number; tripRequests?: number };
  loyaltyBalances?: ClientBalanceSummary[];
  tripRequests?: ClientTripSummary[];
}

export interface ClientCreatePayload {
  firstName: string;
  lastName: string;
  email: string;
  clientType?: 'individual' | 'business';
  phone?: string;
  dateOfBirth?: string;
  notes?: string;
}

export interface FamilyMember {
  id: string;
  clientId: string;
  name: string;
  relationship: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FamilyMemberCreatePayload {
  name: string;
  relationship: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  notes?: string;
}

export interface LoyaltyBalance {
  id: string;
  clientId: string;
  programName: string;
  balance: number;
  expirationDate?: string;
  lastUpdated: string;
  ledgerEntries?: LedgerEntry[];
}

export interface LedgerEntry {
  id: string;
  balanceId: string;
  changeAmount: number;
  reason: string;
  createdAt: string;
}

export interface TradeoffWeights {
  cashCost: number;
  pointsUsage: number;
  redemptionValue: number;
  travelTime: number;
  fewestLayovers: number;
  premiumExperience: number;
  flexibility: number;
  familyConvenience: number;
}

export interface ClientPreference {
  id: string;
  clientId: string;
  preferredCabin?: string;
  prefersNonstop?: boolean;
  maxLayoverMinutes?: number | null;
  willingToReposition?: boolean;
  avoidBasicEconomy?: boolean;
  preferredAirlines?: string[];
  avoidedAirlines?: string[];
  preferredHotelTypes?: string[];
  roomPreferences?: string[];
  locationPreferences?: string;
  redemptionStyle?: string;
  budgetSensitivity?: string;
  pointsVsCash?: string;
  accessibilityNeeds?: string[];
  foodPreferences?: string[];
  activityPreferences?: string[];
  familyConsiderations?: string;
  specialOccasions?: string[];
  dislikes?: string[];
  dealbreakers?: string[];
  defaultTradeoffWeights?: TradeoffWeights | null;
  notes?: string;
  lastUpdatedSource?: 'manual' | 'intake' | 'inferred';
  mergeStrategy?: 'overwrite' | 'merge' | 'suggest';
  createdAt?: string;
  updatedAt?: string;
}

export interface PreferenceChangeLog {
  id: string;
  preferenceId: string;
  changedByUserId: string;
  source: 'manual' | 'intake' | 'inferred';
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
  changedBy?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

export interface MergeDiffItem {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface MergeIntakeResult {
  strategy: 'overwrite' | 'merge' | 'suggest';
  diff: MergeDiffItem[];
  applied: boolean;
  preferences?: ClientPreference;
}

export interface Household {
  id: string;
  orgId: string;
  name: string;
  notes?: string;
  memberCount: number;
  estimatedPortfolioValue?: number;
  createdAt: string;
  updatedAt: string;
  members?: HouseholdMember[];
}

export interface HouseholdMember {
  id: string;
  householdId: string;
  clientId: string;
  client?: Client;
  role?: string;
  addedAt: string;
}

export interface PortfolioSummary {
  totalEstimatedValue: number;
  programExposure: { program: string; value: number; percentage: number }[];
  expiringBalances: { program: string; balance: number; expirationDate: string; clientName: string }[];
  flexibilityBreakdown: { flexible: number; locked: number };
}

export interface TripRequest {
  id: string;
  orgId: string;
  clientId?: string;
  householdId?: string;
  title: string;
  originAirports: string[];
  destinationAirports: string[];
  departureDate: string;
  returnDate?: string;
  travelerCount: number;
  cabinPreference?: string;
  flexibilityDays?: number;
  budgetUsd?: number;
  notes?: string;
  status: 'draft' | 'analyzing' | 'complete' | 'archived';
  createdAt: string;
  updatedAt: string;
  travelers?: TripTraveler[];
  recommendationRuns?: RecommendationRunSummary[];
  client?: Client;
  household?: Household;
}

export interface TripTraveler {
  id: string;
  tripRequestId: string;
  clientId: string;
  client?: Client;
}

export interface TripRequestCreatePayload {
  clientId?: string;
  householdId?: string;
  title: string;
  originAirports: string[];
  destinationAirports: string[];
  departureDate: string;
  returnDate?: string;
  travelerCount: number;
  cabinPreference?: string;
  flexibilityDays?: number;
  budgetUsd?: number;
  notes?: string;
}

export interface RecommendationRunSummary {
  id: string;
  tripRequestId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
}

export interface RecommendationRun {
  id: string;
  tripRequestId: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  tripRequest?: TripRequest;
  topRecommendation?: RecommendationOption;
  alternatives?: RecommendationOption[];
  insights?: RecommendationInsight[];
  memo?: RecommendationMemo;
}

export interface RecommendationOption {
  id: string;
  runId: string;
  strategyTitle: string;
  strategyType: 'points_only' | 'cash_only' | 'mixed' | 'hold_and_wait';
  totalCashCost: number;
  pointsUsedSummary: string;
  score: number;
  isRecommended: boolean;
  summary?: string;
  whyChosen?: string;
  whyNotChosen?: string;
  travelerAllocations?: TravelerAllocation[];
}

export interface TravelerAllocation {
  id: string;
  optionId: string;
  travelerName: string;
  paymentType: 'points' | 'cash' | 'mixed';
  program?: string;
  pointsUsed?: number;
  cashAmount: number;
  taxes: number;
  rationale?: string;
}

export interface RecommendationInsight {
  id: string;
  runId: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
}

export interface RecommendationMemo {
  id: string;
  runId: string;
  internalSummary?: string;
  clientSummary?: string;
  emailDraft?: string;
}

export interface AlertEvent {
  id: string;
  orgId: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  category: string;
  isRead: boolean;
  entityType?: string;
  entityId?: string;
  createdAt: string;
}

export interface AlertSubscription {
  id: string;
  orgId: string;
  userId: string;
  category: string;
  enabled: boolean;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  users?: OrgUser[];
  transferBonuses?: TransferBonus[];
}

export interface OrgUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface TransferBonus {
  id: string;
  orgId: string;
  fromProgram: string;
  toProgram: string;
  bonusPercentage: number;
  startDate: string;
  endDate: string;
  notes?: string;
}

export interface TransferBonusDetail {
  id: string;
  fromProgram: string;
  fromProgramCode: string;
  toProgram: string;
  toProgramCode: string;
  bonusPercent: number;
  startsAt: string;
  endsAt: string;
  sourceUrl?: string;
  sourceLabel?: string;
}

export interface ExpiringPointsItem {
  id: string;
  clientId: string;
  clientName: string;
  programName: string;
  programCode: string;
  balance: number;
  expirationDate: string;
}

export interface ClientIntake {
  id: string;
  clientId: string;
  createdByUserId: string;
  status: 'draft' | 'complete';
  isTemplate: boolean;
  templateName?: string;
  duplicatedFromId?: string;

  tripType?: string;
  tripTypeOther?: string;
  destinations?: string[];
  departureAirports?: string[];
  dateFlexibility?: string;
  earliestDeparture?: string;
  latestReturn?: string;
  tripDurationDays?: number;

  budgetMin?: number;
  budgetMax?: number;
  budgetCurrency: string;
  budgetNotes?: string;

  cabinPreference?: string;
  hotelStyles?: string[];
  loyaltyNotes?: string;

  accessibilityNeeds?: string;
  dietaryNeeds?: string;

  travelPace?: string;
  layoverTolerance?: string;
  luxuryPreference?: string;
  familyFriendly?: boolean;
  travelerCount?: number;
  childrenCount?: number;
  childrenAges?: number[];

  desiredExperiences?: string[];
  dealbreakers?: string[];
  preferredAirlines?: string[];
  avoidedAirlines?: string[];

  notes?: string;

  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type ClientIntakePayload = Partial<
  Omit<ClientIntake, 'id' | 'clientId' | 'createdByUserId' | 'createdAt' | 'updatedAt' | 'completedAt'>
>;

export interface ConfidenceDimension {
  key: string;
  label: string;
  weight: number;
  score: number;
  maxScore: number;
  status: 'resolved' | 'ambiguous' | 'missing';
  detail: string;
  suggestedQuestion?: string;
}

export interface ConfidenceResult {
  score: number;
  level: 'low' | 'medium' | 'high';
  dimensions: ConfidenceDimension[];
  missingFields: ConfidenceDimension[];
  ambiguousFields: ConfidenceDimension[];
  resolvedFields: ConfidenceDimension[];
  suggestedQuestions: { dimension: string; question: string }[];
}

export interface TripBrief {
  id: string;
  tripRequestId?: string;
  clientId: string;
  intakeId?: string;
  version: number;
  executiveSummary?: string;
  hardConstraints?: string;
  softPreferences?: string;
  pointsCashPosture?: string;
  acceptableTradeoffs?: string;
  doNotRecommend?: string;
  operationalNotes?: string;
  isEdited: boolean;
  createdAt: string;
  updatedAt: string;
  generatedBy?: { firstName: string; lastName: string };
}

export interface TripBriefVersion {
  id: string;
  version: number;
  isEdited: boolean;
  createdAt: string;
  generatedBy?: { firstName: string; lastName: string };
}

export interface InferredPreference {
  id: string;
  clientId: string;
  category: string;
  label: string;
  description: string;
  confidence: number;
  evidence: Record<string, unknown>;
  status: 'pending' | 'accepted' | 'rejected';
  resolvedAt?: string;
  resolvedByUserId?: string;
  appliedToProfile: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedBy?: { firstName: string; lastName: string };
}

export interface InferenceGenerateResponse {
  generated: number;
  inferences: InferredPreference[];
}

export type SuggestionStatus = 'pending' | 'asked' | 'answered' | 'skipped';
export type SuggestionPriority = 'high' | 'medium' | 'low';
export type SuggestionCategory =
  | 'missing_intake'
  | 'ambiguous_preference'
  | 'conflicting_constraint'
  | 'budget_luxury_mismatch'
  | 'points_convenience_mismatch'
  | 'destination_flexibility'
  | 'group_traveler_difference';

export interface FollowUpSuggestion {
  id: string;
  clientId: string;
  intakeId?: string;
  category: SuggestionCategory;
  priority: SuggestionPriority;
  questionText: string;
  reason: string;
  ruleKey: string;
  status: SuggestionStatus;
  statusChangedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageDraft {
  subject: string;
  body: string;
  suggestion: {
    id: string;
    questionText: string;
    reason: string;
  };
}

export interface DashboardData {
  advisorName: string;
  totalClients: number;
  transferBonuses: TransferBonusDetail[];
  transferBonusCount: number;
  activeTripAnalyses: TripRequest[];
  recentAlerts: AlertEvent[];
}

// ---------------------------------------------------------------------------
// Vendor Operations Types
// ---------------------------------------------------------------------------

export type VendorRequestStatus =
  | 'draft'
  | 'needs_advisor_review'
  | 'needs_client_approval'
  | 'approved_to_send'
  | 'sent_to_vendor'
  | 'awaiting_vendor_response'
  | 'follow_up_needed'
  | 'confirmed'
  | 'declined'
  | 'complete'
  | 'cancelled';

export type VendorRequestType =
  | 'room_upgrade'
  | 'early_check_in'
  | 'late_check_out'
  | 'connecting_rooms'
  | 'airport_transfer'
  | 'amenity_request'
  | 'dining_request'
  | 'celebration_request'
  | 'quote_request'
  | 'custom_request';

export type VendorRequestUrgency = 'low' | 'medium' | 'high' | 'urgent';
export type ReminderStatus = 'pending' | 'completed' | 'snoozed' | 'auto_resolved';
export type DraftTone = 'gentle_nudge' | 'firm_reminder' | 'escalation' | 'urgent_deadline';

export interface VendorRequest {
  id: string;
  organizationId: string;
  tripRequestId: string;
  clientId?: string | null;
  createdByUserId: string;
  templateId?: string | null;
  vendorName: string;
  vendorContact?: string | null;
  requestType: VendorRequestType;
  requestDetails?: string | null;
  dateSent?: string | null;
  urgency: VendorRequestUrgency;
  dueDate?: string | null;
  status: VendorRequestStatus;
  followUpCount: number;
  internalNotes?: string | null;
  finalOutcome?: string | null;
  firstResponseAt?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  tripRequest?: { id: string; title: string; departureDate?: string };
  client?: { id: string; firstName: string; lastName: string } | null;
  createdBy?: { id: string; firstName: string; lastName: string };
  reminders?: VendorRequestReminder[];
  drafts?: VendorRequestDraft[];
  approvals?: VendorRequestApproval[];
  timeline?: VendorRequestTimeline[];
  _count?: { drafts: number; approvals: number; reminders: number };
}

export interface VendorRequestReminder {
  id: string;
  vendorRequestId: string;
  status: ReminderStatus;
  remindAt: string;
  label?: string | null;
  snoozedUntil?: string | null;
  completedAt?: string | null;
  createdAt: string;
  vendorRequest?: {
    id: string;
    vendorName: string;
    requestType: string;
    urgency: string;
    status: string;
    dueDate?: string | null;
    tripRequest?: { id: string; title: string };
    client?: { firstName: string; lastName: string } | null;
  };
}

export interface VendorRequestDraft {
  id: string;
  vendorRequestId: string;
  tone: DraftTone;
  generatedBody: string;
  editedBody?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface VendorRequestApproval {
  id: string;
  vendorRequestId: string;
  fromStatus: VendorRequestStatus;
  toStatus: VendorRequestStatus;
  approvedByUserId?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface VendorRequestTimeline {
  id: string;
  vendorRequestId: string;
  eventType: string;
  description: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface VendorRequestTemplate {
  id: string;
  organizationId?: string | null;
  scope: 'system' | 'organization';
  title: string;
  requestType: VendorRequestType;
  defaultBody: string;
  placeholders?: Record<string, string>;
  defaultUrgency: VendorRequestUrgency;
  defaultReminders?: number[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VendorStats {
  vendorName: string;
  totalRequests: number;
  confirmedCount: number;
  declinedCount: number;
  avgResponseHours: number | null;
  avgResolutionHours: number | null;
  avgFollowUps: number | null;
  overdueCount: number;
  confirmationRate: number | null;
  declineRate: number | null;
  overdueRate: number | null;
  score: number | null;
  confidence: string;
}

export interface VendorScoreSummary {
  id: string;
  organizationId: string;
  vendorName: string;
  totalRequests: number;
  confirmedCount: number;
  declinedCount: number;
  avgResponseHours: number | null;
  avgResolutionHours: number | null;
  avgFollowUps: number | null;
  overdueCount: number;
  score: number | null;
  confidence: string | null;
}

export interface OperationsDashboardData {
  totalOpenRequests: number;
  overdueRequests: number;
  pendingReminders: number;
  awaitingApproval: number;
  recentActivity: Array<{
    id: string;
    eventType: string;
    description: string;
    vendorRequestId: string;
    vendorName?: string;
    createdAt: string;
  }>;
  tripSummaries: Array<{
    tripRequestId: string;
    tripTitle: string;
    clientName: string | null;
    openRequests: number;
    overdueRequests: number;
    pendingReminders: number;
    awaitingApproval: number;
    atRisk: boolean;
    departureDate: string;
  }>;
  topVendors: Array<{
    vendorName: string;
    score: number | null;
    confidence: string | null;
    totalRequests: number;
  }>;
  requestsByStatus: Record<string, number>;
}

export interface TranslatorSuggestion {
  category: string;
  vendorAsk: string;
  specificity: 'high' | 'medium' | 'low';
  requestType: string;
  confidence: number;
}

export interface TranslatorResult {
  suggestions: TranslatorSuggestion[];
  clarifyingQuestions: string[];
}

export interface WorkflowInfo {
  currentStatus: VendorRequestStatus;
  availableTransitions: VendorRequestStatus[];
}

// ---------------------------------------------------------------------------
// Meeting Copilot Types
// ---------------------------------------------------------------------------

export type MeetingSessionStatus = 'active' | 'completed' | 'archived';
export type MeetingEntryRole = 'advisor_note' | 'question_answer' | 'system';
export type ProfileSuggestionStatus = 'pending' | 'approved' | 'rejected' | 'committed';

export interface MeetingSession {
  id: string;
  clientId: string;
  advisorUserId: string;
  title: string;
  status: MeetingSessionStatus;
  summary?: string | null;
  createdAt: string;
  updatedAt: string;
  entries?: MeetingEntryItem[];
  questionSuggestions?: MeetingQuestionSuggestion[];
  profileSuggestions?: MeetingProfileSuggestion[];
  recap?: MeetingRecap | null;
  advisor?: { id: string; firstName: string; lastName: string; email: string };
  _count?: { entries: number; profileSuggestions: number };
}

export interface MeetingEntryItem {
  id: string;
  sessionId: string;
  role: MeetingEntryRole;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface MeetingQuestionSuggestion {
  id: string;
  sessionId: string;
  questionText: string;
  category: string;
  reason: string;
  priority: string;
  targetFields: string[];
  isUsed: boolean;
  createdAt: string;
}

export interface MeetingProfileSuggestion {
  id: string;
  sessionId: string;
  targetField: string;
  suggestedValue: unknown;
  confidence: number;
  evidence: string;
  rationale: string;
  status: ProfileSuggestionStatus;
  resolvedAt?: string | null;
  createdAt: string;
}

export interface MeetingRecap {
  id: string;
  sessionId: string;
  travelerSummary: string;
  newPreferencesLearned: string;
  unresolvedQuestions: string;
  nextSteps: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingCommitPreviewItem {
  id: string;
  targetField: string;
  currentValue: unknown;
  suggestedValue: unknown;
  confidence: number;
  evidence: string;
  rationale: string;
  willOverwrite: boolean;
}

export interface MeetingCommitResult {
  committed: number;
  preference: ClientPreference;
  fields: string[];
}

export interface MeetingQuestionsResult {
  generated: number;
  questions: MeetingQuestionSuggestion[];
}

export interface MeetingExtractResult {
  extracted: number;
  suggestions: MeetingProfileSuggestion[];
}

// ---------------------------------------------------------------------------
// Base fetch
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('tripy_token') : null;
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(err.error || err.message || 'Request failed', res.status);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function loginApi(email: string, password: string) {
  return apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function signupApi(payload: {
  organizationName: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}) {
  return apiFetch<AuthResponse>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getMe() {
  return apiFetch<User>('/me');
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function getDashboard() {
  return apiFetch<DashboardData>('/dashboard');
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export function getClients() {
  return apiFetch<Client[]>('/clients');
}

export function getClient(id: string) {
  return apiFetch<Client>(`/clients/${id}`);
}

export function createClient(payload: ClientCreatePayload) {
  return apiFetch<Client>('/clients', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateClient(id: string, payload: Partial<ClientCreatePayload>) {
  return apiFetch<Client>(`/clients/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function getClientBalances(clientId: string) {
  return apiFetch<LoyaltyBalance[]>(`/clients/${clientId}/balances`);
}

export function addClientBalance(
  clientId: string,
  payload: { programName: string; balance: number; expirationDate?: string },
) {
  return apiFetch<LoyaltyBalance>(`/clients/${clientId}/balances`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getClientPreferences(clientId: string) {
  return apiFetch<ClientPreference>(`/clients/${clientId}/preferences`);
}

export function updateClientPreferences(
  clientId: string,
  payload: Partial<ClientPreference> & { _source?: 'manual' | 'intake' | 'inferred' },
) {
  return apiFetch<ClientPreference>(`/clients/${clientId}/preferences`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function getPreferenceHistory(clientId: string) {
  return apiFetch<PreferenceChangeLog[]>(`/clients/${clientId}/preferences/history`);
}

export function mergeIntakeIntoPreferences(
  clientId: string,
  intakeData: Record<string, unknown>,
  strategy?: 'overwrite' | 'merge' | 'suggest',
) {
  return apiFetch<MergeIntakeResult>(`/clients/${clientId}/preferences/merge`, {
    method: 'POST',
    body: JSON.stringify({ intakeData, strategy }),
  });
}

// ---------------------------------------------------------------------------
// Family Members
// ---------------------------------------------------------------------------

export function getFamilyMembers(clientId: string) {
  return apiFetch<FamilyMember[]>(`/clients/${clientId}/family-members`);
}

export function addFamilyMember(clientId: string, payload: FamilyMemberCreatePayload) {
  return apiFetch<FamilyMember>(`/clients/${clientId}/family-members`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function removeFamilyMember(clientId: string, memberId: string) {
  return apiFetch<void>(`/clients/${clientId}/family-members/${memberId}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Inferred Preferences
// ---------------------------------------------------------------------------

export function getInferredPreferences(clientId: string, refresh = false) {
  const qs = refresh ? '?refresh=true' : '';
  return apiFetch<InferredPreference[]>(`/clients/${clientId}/inferred-preferences${qs}`);
}

export function generateInferredPreferences(clientId: string) {
  return apiFetch<InferenceGenerateResponse>(`/clients/${clientId}/inferred-preferences`, {
    method: 'POST',
  });
}

export function resolveInferredPreference(
  clientId: string,
  inferenceId: string,
  status: 'accepted' | 'rejected',
) {
  return apiFetch<InferredPreference>(
    `/clients/${clientId}/inferred-preferences/${inferenceId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    },
  );
}

// ---------------------------------------------------------------------------
// Client Trip Requests
// ---------------------------------------------------------------------------

export function getClientTrips(clientId: string) {
  return apiFetch<TripRequest[]>(`/clients/${clientId}/trips`);
}

export function createClientTrip(
  clientId: string,
  payload: Omit<TripRequestCreatePayload, 'clientId' | 'householdId'>,
) {
  return apiFetch<TripRequest>(`/clients/${clientId}/trips`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Households (legacy)
// ---------------------------------------------------------------------------

export function getHouseholds() {
  return apiFetch<Household[]>('/households');
}

export function getHousehold(id: string) {
  return apiFetch<Household>(`/households/${id}`);
}

export function createHousehold(payload: { name: string; notes?: string }) {
  return apiFetch<Household>('/households', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function addHouseholdMember(householdId: string, clientId: string) {
  return apiFetch<HouseholdMember>(`/households/${householdId}/members`, {
    method: 'POST',
    body: JSON.stringify({ clientId }),
  });
}

export function removeHouseholdMember(householdId: string, memberId: string) {
  return apiFetch<void>(`/households/${householdId}/members/${memberId}`, {
    method: 'DELETE',
  });
}

export function getPortfolioSummary(householdId: string) {
  return apiFetch<PortfolioSummary>(`/households/${householdId}/portfolio-summary`);
}

// ---------------------------------------------------------------------------
// Trip Requests
// ---------------------------------------------------------------------------

export function getTripRequests() {
  return apiFetch<TripRequest[]>('/trip-requests');
}

export function getTripRequest(id: string) {
  return apiFetch<TripRequest>(`/trip-requests/${id}`);
}

export function createTripRequest(payload: TripRequestCreatePayload) {
  return apiFetch<TripRequest>('/trip-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function addTripTraveler(tripId: string, clientId: string) {
  return apiFetch<TripTraveler>(`/trip-requests/${tripId}/travelers`, {
    method: 'POST',
    body: JSON.stringify({ clientId }),
  });
}

export function removeTripTraveler(tripId: string, travelerId: string) {
  return apiFetch<void>(`/trip-requests/${tripId}/travelers/${travelerId}`, {
    method: 'DELETE',
  });
}

export function getTripConfidence(tripId: string) {
  return apiFetch<ConfidenceResult>(`/trip-requests/${tripId}/confidence`);
}

export function analyzeTripRequest(tripId: string) {
  return apiFetch<RecommendationRunSummary>(`/trip-requests/${tripId}/analyze`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Trip Tradeoff Rankings
// ---------------------------------------------------------------------------

export interface TradeoffRanking {
  id?: string;
  tripRequestId: string;
  cashCost: number;
  pointsUsage: number;
  redemptionValue: number;
  travelTime: number;
  fewestLayovers: number;
  premiumExperience: number;
  flexibility: number;
  familyConvenience: number;
}

export function getTradeoffRanking(tripId: string) {
  return apiFetch<TradeoffRanking>(`/trip-requests/${tripId}/tradeoff-ranking`);
}

export function updateTradeoffRanking(tripId: string, weights: Partial<TradeoffWeights>) {
  return apiFetch<TradeoffRanking>(`/trip-requests/${tripId}/tradeoff-ranking`, {
    method: 'PUT',
    body: JSON.stringify(weights),
  });
}

export function getClientDefaultTradeoffWeights(clientId: string) {
  return apiFetch<ClientPreference>(`/clients/${clientId}/preferences`).then(
    (pref) => (pref?.defaultTradeoffWeights as TradeoffWeights | null) ?? null,
  );
}

// ---------------------------------------------------------------------------
// Recommendation Runs
// ---------------------------------------------------------------------------

export function getRecommendationRun(id: string) {
  return apiFetch<RecommendationRun>(`/recommendation-runs/${id}`);
}

export function selectRecommendationOption(runId: string, optionId: string) {
  return apiFetch<RecommendationRun>(`/recommendation-runs/${runId}/select`, {
    method: 'POST',
    body: JSON.stringify({ optionId }),
  });
}

export function generateMemo(runId: string) {
  return apiFetch<RecommendationMemo>(`/recommendation-runs/${runId}/memo`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export function getAlerts(params?: { unreadOnly?: boolean; category?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.unreadOnly) searchParams.set('unread_only', 'true');
  if (params?.category) searchParams.set('category', params.category);
  const qs = searchParams.toString();
  return apiFetch<AlertEvent[]>(`/alerts${qs ? `?${qs}` : ''}`);
}

export function markAlertRead(alertId: string) {
  return apiFetch<AlertEvent>(`/alerts/${alertId}/read`, {
    method: 'POST',
  });
}

export function getAlertSubscriptions() {
  return apiFetch<AlertSubscription[]>('/alert-subscriptions');
}

export function updateAlertSubscription(subId: string, enabled: boolean) {
  return apiFetch<AlertSubscription>(`/alert-subscriptions/${subId}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export function getOrganization() {
  return apiFetch<Organization>('/organization');
}

export function updateOrganization(payload: { name?: string; slug?: string }) {
  return apiFetch<Organization>('/organization', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function createTransferBonus(payload: Omit<TransferBonus, 'id' | 'orgId'>) {
  return apiFetch<TransferBonus>('/organization/transfer-bonuses', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Transfer Bonus Scraping
// ---------------------------------------------------------------------------

export function scrapeTransferBonuses() {
  return apiFetch<{ success: boolean; scraped: number; synced: number; skipped: number; message: string }>(
    '/scrape-transfer-bonuses',
    { method: 'POST' },
  );
}

// ---------------------------------------------------------------------------
// Follow-Up Suggestions
// ---------------------------------------------------------------------------

export function getFollowUpSuggestions(clientId: string, status?: SuggestionStatus) {
  const qs = status ? `?status=${status}` : '';
  return apiFetch<FollowUpSuggestion[]>(`/clients/${clientId}/follow-up-suggestions${qs}`);
}

export function generateFollowUpSuggestions(clientId: string) {
  return apiFetch<FollowUpSuggestion[]>(`/clients/${clientId}/follow-up-suggestions`, {
    method: 'POST',
  });
}

export function updateSuggestionStatus(clientId: string, suggestionId: string, status: SuggestionStatus) {
  return apiFetch<FollowUpSuggestion>(`/clients/${clientId}/follow-up-suggestions/${suggestionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function getSuggestionMessageDraft(clientId: string, suggestionId: string) {
  return apiFetch<MessageDraft>(`/clients/${clientId}/follow-up-suggestions/${suggestionId}/message-draft`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Trip Briefs
// ---------------------------------------------------------------------------

export function getTripBrief(tripId: string) {
  return apiFetch<TripBrief | null>(`/trip-requests/${tripId}/brief`);
}

export function generateTripBrief(tripId: string) {
  return apiFetch<TripBrief>(`/trip-requests/${tripId}/brief/generate`, {
    method: 'POST',
  });
}

export function updateTripBrief(tripId: string, payload: Partial<Pick<TripBrief,
  'executiveSummary' | 'hardConstraints' | 'softPreferences' | 'pointsCashPosture' |
  'acceptableTradeoffs' | 'doNotRecommend' | 'operationalNotes'
>>) {
  return apiFetch<TripBrief>(`/trip-requests/${tripId}/brief`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function getTripBriefVersions(tripId: string) {
  return apiFetch<TripBriefVersion[]>(`/trip-requests/${tripId}/brief/versions`);
}

// ---------------------------------------------------------------------------
// Client Intakes
// ---------------------------------------------------------------------------

export function getClientIntakes(clientId: string) {
  return apiFetch<ClientIntake[]>(`/clients/${clientId}/intakes`);
}

export function getClientIntake(clientId: string, intakeId: string) {
  return apiFetch<ClientIntake>(`/clients/${clientId}/intakes/${intakeId}`);
}

export function createClientIntake(clientId: string, payload: ClientIntakePayload) {
  return apiFetch<ClientIntake>(`/clients/${clientId}/intakes`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateClientIntake(clientId: string, intakeId: string, payload: ClientIntakePayload) {
  return apiFetch<ClientIntake>(`/clients/${clientId}/intakes/${intakeId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteClientIntake(clientId: string, intakeId: string) {
  return apiFetch<{ success: boolean }>(`/clients/${clientId}/intakes/${intakeId}`, {
    method: 'DELETE',
  });
}

export function duplicateClientIntake(clientId: string, intakeId: string, targetClientId?: string) {
  return apiFetch<ClientIntake>(`/clients/${clientId}/intakes/${intakeId}/duplicate`, {
    method: 'POST',
    body: JSON.stringify(targetClientId ? { targetClientId } : {}),
  });
}

// ---------------------------------------------------------------------------
// Vendor Requests
// ---------------------------------------------------------------------------

export function getVendorRequests(params?: {
  tripRequestId?: string;
  status?: string;
  vendorName?: string;
}) {
  const sp = new URLSearchParams();
  if (params?.tripRequestId) sp.set('tripRequestId', params.tripRequestId);
  if (params?.status) sp.set('status', params.status);
  if (params?.vendorName) sp.set('vendorName', params.vendorName);
  const qs = sp.toString();
  return apiFetch<VendorRequest[]>(`/vendor-requests${qs ? `?${qs}` : ''}`);
}

export function getVendorRequest(id: string) {
  return apiFetch<VendorRequest>(`/vendor-requests/${id}`);
}

export function createVendorRequest(payload: {
  tripRequestId: string;
  clientId?: string;
  vendorName: string;
  vendorContact?: string;
  requestType: VendorRequestType;
  requestDetails?: string;
  urgency?: VendorRequestUrgency;
  dueDate?: string;
  internalNotes?: string;
  customReminderHours?: number[];
}) {
  return apiFetch<VendorRequest>('/vendor-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateVendorRequest(
  id: string,
  payload: Partial<{
    vendorName: string;
    vendorContact: string;
    requestDetails: string;
    urgency: VendorRequestUrgency;
    dueDate: string;
    internalNotes: string;
    followUpCount: number;
    finalOutcome: string;
  }>,
) {
  return apiFetch<VendorRequest>(`/vendor-requests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteVendorRequest(id: string) {
  return apiFetch<{ success: boolean }>(`/vendor-requests/${id}`, {
    method: 'DELETE',
  });
}

export function archiveVendorRequest(id: string) {
  return apiFetch<VendorRequest>(`/vendor-requests/${id}/archive`, {
    method: 'POST',
  });
}

export function createVendorRequestFromTemplate(payload: {
  templateId: string;
  tripRequestId: string;
  vendorName: string;
  vendorContact?: string;
  clientId?: string;
  dueDate?: string;
  variables?: Record<string, string>;
}) {
  return apiFetch<VendorRequest>('/vendor-requests/from-template', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export function getReminders(params?: { status?: string; dueBefore?: string }) {
  const sp = new URLSearchParams();
  if (params?.status) sp.set('status', params.status);
  if (params?.dueBefore) sp.set('dueBefore', params.dueBefore);
  const qs = sp.toString();
  return apiFetch<VendorRequestReminder[]>(`/reminders${qs ? `?${qs}` : ''}`);
}

export function getRequestReminders(vendorRequestId: string) {
  return apiFetch<VendorRequestReminder[]>(
    `/vendor-requests/${vendorRequestId}/reminders`,
  );
}

export function updateReminder(
  vendorRequestId: string,
  action: 'complete' | 'snooze' | 'dismiss' | 'sync',
  reminderId?: string,
  snoozedUntil?: string,
) {
  return apiFetch<VendorRequestReminder | VendorRequestReminder[]>(
    `/vendor-requests/${vendorRequestId}/reminders`,
    {
      method: 'POST',
      body: JSON.stringify({ action, reminderId, snoozedUntil }),
    },
  );
}

// ---------------------------------------------------------------------------
// Draft Generation
// ---------------------------------------------------------------------------

export function getRequestDrafts(vendorRequestId: string) {
  return apiFetch<VendorRequestDraft[]>(
    `/vendor-requests/${vendorRequestId}/drafts`,
  );
}

export function generateDraft(vendorRequestId: string, tone: DraftTone) {
  return apiFetch<VendorRequestDraft>(
    `/vendor-requests/${vendorRequestId}/drafts`,
    { method: 'POST', body: JSON.stringify({ tone }) },
  );
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export function getWorkflowInfo(vendorRequestId: string) {
  return apiFetch<WorkflowInfo>(
    `/vendor-requests/${vendorRequestId}/workflow`,
  );
}

export function transitionWorkflow(
  vendorRequestId: string,
  toStatus: VendorRequestStatus,
  notes?: string,
) {
  return apiFetch<VendorRequest>(
    `/vendor-requests/${vendorRequestId}/workflow`,
    { method: 'POST', body: JSON.stringify({ toStatus, notes }) },
  );
}

// ---------------------------------------------------------------------------
// Vendor Templates
// ---------------------------------------------------------------------------

export function getVendorTemplates() {
  return apiFetch<VendorRequestTemplate[]>('/vendor-templates');
}

export function createVendorTemplate(payload: {
  title: string;
  requestType: VendorRequestType;
  defaultBody: string;
  placeholders?: Record<string, string>;
  defaultUrgency?: VendorRequestUrgency;
  defaultReminders?: number[];
}) {
  return apiFetch<VendorRequestTemplate>('/vendor-templates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateVendorTemplate(
  id: string,
  payload: Partial<{
    title: string;
    defaultBody: string;
    placeholders: Record<string, string>;
    defaultUrgency: VendorRequestUrgency;
    defaultReminders: number[];
    isActive: boolean;
  }>,
) {
  return apiFetch<VendorRequestTemplate>(`/vendor-templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteVendorTemplate(id: string) {
  return apiFetch<{ success: boolean }>(`/vendor-templates/${id}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Vendor Stats
// ---------------------------------------------------------------------------

export function getVendorStats(vendorName?: string) {
  const qs = vendorName ? `?vendorName=${encodeURIComponent(vendorName)}` : '';
  return apiFetch<VendorStats | VendorScoreSummary[]>(`/vendor-stats${qs}`);
}

// ---------------------------------------------------------------------------
// Operations Dashboard
// ---------------------------------------------------------------------------

export function getOperationsDashboard() {
  return apiFetch<OperationsDashboardData>('/operations/dashboard');
}

// ---------------------------------------------------------------------------
// Client-to-Vendor Translator
// ---------------------------------------------------------------------------

export function translateClientRequest(payload: {
  vagueRequest: string;
  clientName?: string;
  tripType?: string;
  tripDestination?: string;
}) {
  return apiFetch<TranslatorResult>('/operations/translate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Meeting Copilot
// ---------------------------------------------------------------------------

export function getMeetingSessions(clientId: string) {
  return apiFetch<MeetingSession[]>(`/clients/${clientId}/meetings`);
}

export function getMeetingSession(clientId: string, meetingId: string) {
  return apiFetch<MeetingSession>(`/clients/${clientId}/meetings/${meetingId}`);
}

export function createMeetingSession(clientId: string, title: string) {
  return apiFetch<MeetingSession>(`/clients/${clientId}/meetings`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export function updateMeetingSession(
  clientId: string,
  meetingId: string,
  payload: Partial<Pick<MeetingSession, 'title' | 'status' | 'summary'>>,
) {
  return apiFetch<MeetingSession>(`/clients/${clientId}/meetings/${meetingId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function appendMeetingEntry(
  clientId: string,
  meetingId: string,
  payload: { role: MeetingEntryRole; content: string; metadata?: Record<string, unknown> },
) {
  return apiFetch<MeetingEntryItem>(`/clients/${clientId}/meetings/${meetingId}/entries`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function generateMeetingQuestions(
  clientId: string,
  meetingId: string,
  options?: { followUp?: boolean; latestAnswer?: string },
) {
  return apiFetch<MeetingQuestionsResult>(
    `/clients/${clientId}/meetings/${meetingId}/questions`,
    {
      method: 'POST',
      body: JSON.stringify(options || {}),
    },
  );
}

export function extractMeetingProfileSuggestions(
  clientId: string,
  meetingId: string,
) {
  return apiFetch<MeetingExtractResult>(
    `/clients/${clientId}/meetings/${meetingId}/extract`,
    { method: 'POST' },
  );
}

export function updateMeetingProfileSuggestion(
  clientId: string,
  meetingId: string,
  suggestionId: string,
  status: 'approved' | 'rejected',
) {
  return apiFetch<MeetingProfileSuggestion>(
    `/clients/${clientId}/meetings/${meetingId}/suggestions/${suggestionId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    },
  );
}

export function getMeetingCommitPreview(
  clientId: string,
  meetingId: string,
) {
  return apiFetch<{ preview: MeetingCommitPreviewItem[] }>(
    `/clients/${clientId}/meetings/${meetingId}/commit`,
  );
}

export function commitMeetingSuggestions(
  clientId: string,
  meetingId: string,
) {
  return apiFetch<MeetingCommitResult>(
    `/clients/${clientId}/meetings/${meetingId}/commit`,
    { method: 'POST' },
  );
}

export function getMeetingRecap(
  clientId: string,
  meetingId: string,
) {
  return apiFetch<MeetingRecap | null>(
    `/clients/${clientId}/meetings/${meetingId}/recap`,
  );
}

export function generateMeetingRecap(
  clientId: string,
  meetingId: string,
) {
  return apiFetch<MeetingRecap>(
    `/clients/${clientId}/meetings/${meetingId}/recap`,
    { method: 'POST' },
  );
}
