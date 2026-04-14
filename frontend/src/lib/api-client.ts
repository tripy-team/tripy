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
  clientType: 'individual' | 'group' | 'business';
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
  groupProfile?: GroupProfile | null;
  businessProfile?: BusinessProfile | null;
}

export interface InitialBalanceEntry {
  loyaltyProgramId: string;
  balance: number;
  expirationDate?: string;
  notes?: string;
}

export interface ClientCreatePayload {
  firstName: string;
  lastName: string;
  email: string;
  clientType?: 'individual' | 'group' | 'business';
  phone?: string;
  dateOfBirth?: string;
  notes?: string;
  initialBalances?: InitialBalanceEntry[];
  groupProfile?: Partial<GroupProfilePayload>;
  businessProfile?: Partial<BusinessProfilePayload>;
}

export interface LinkedClientSummary {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  loyaltyBalances?: LoyaltyBalance[];
  preferences?: ClientPreference;
}

export interface FamilyMember {
  id: string;
  clientId: string;
  linkedClientId?: string;
  linkedClient?: LinkedClientSummary;
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
  existingClientId?: string;
  firstName: string;
  lastName: string;
  relationship: string;
  email: string;
  phone?: string;
  dateOfBirth?: string;
  notes?: string;
  loyaltyBalances?: { loyaltyProgramId: string; balance: number }[];
}

export interface FamilyMemberUpdatePayload {
  firstName?: string;
  lastName?: string;
  relationship?: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  notes?: string;
}

export interface LoyaltyProgramRecord {
  id: string;
  code: string;
  name: string;
  category: string;
  issuer?: string;
}

export interface LoyaltyBalance {
  id: string;
  clientId: string;
  loyaltyProgramId: string;
  loyaltyProgram?: LoyaltyProgramRecord;
  programName: string;
  balance: number;
  expirationDate?: string;
  updatedAt: string;
  createdAt: string;
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
  budgetCash?: number;
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
  originAirports?: string[];
  destinationAirports?: string[];
  useLeaderCities?: boolean;
  departureDate?: string;
  returnDate?: string;
  cabinPreference?: string;
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
  budgetCash?: number;
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
  strategyType: 'points_only' | 'cash_only' | 'mixed' | 'hold_and_wait' | 'group_pooled';
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
  round: number;
  createdAt: string;
}

export interface AnsweredQuestionPayload {
  questionText: string;
  answer: string;
  category?: string;
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
  targetClientId?: string | null;
  targetClient?: { id: string; firstName: string; lastName: string } | null;
  sourceDescription?: string | null;
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
  targetClientId?: string | null;
  targetClientName?: string | null;
}

export interface MeetingCommitResult {
  committed: number;
  preference: ClientPreference;
  fields: string[];
}

export interface MeetingQuestionsResult {
  generated: number;
  questions: MeetingQuestionSuggestion[];
  round: number;
  profileCompleteness?: number;
}

export interface MeetingExtractResult {
  extracted: number;
  suggestions: MeetingProfileSuggestion[];
}

export interface MeetingEntryWithExtractions extends MeetingEntryItem {
  extractedSuggestions?: MeetingProfileSuggestion[];
  autoCommittedFields?: string[];
}

export interface ProfileCompletenessData {
  overallPercent: number;
  readyForTripPlanning: boolean;
  filledFields: string[];
  emptyFields: string[];
  emptyCriticalFields: string[];
  categoryBreakdown: Record<string, { filled: number; total: number; percent: number }>;
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
  payload: { loyaltyProgramId: string; balance: number; expirationDate?: string },
) {
  return apiFetch<LoyaltyBalance>(`/clients/${clientId}/balances`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getLoyaltyPrograms() {
  return apiFetch<LoyaltyProgramRecord[]>('/loyalty-programs');
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

export function updateFamilyMember(clientId: string, memberId: string, payload: FamilyMemberUpdatePayload) {
  return apiFetch<FamilyMember>(`/clients/${clientId}/family-members/${memberId}`, {
    method: 'PATCH',
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

export function addTripTraveler(
  tripId: string,
  clientId: string,
  options?: {
    originAirports?: string[];
    destinationAirports?: string[];
    useLeaderCities?: boolean;
    departureDate?: string;
    returnDate?: string;
    cabinPreference?: string;
  },
) {
  return apiFetch<TripTraveler>(`/trip-requests/${tripId}/travelers`, {
    method: 'POST',
    body: JSON.stringify({ clientId, ...options }),
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
// Itinerary Generation
// ---------------------------------------------------------------------------

export interface ItineraryFlightRecommendation {
  segment: string;
  airline: string;
  flightExample: string;
  cabin: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  stops: number;
  pointsOption?: {
    program: string;
    pointsRequired: number;
    transferFrom?: string;
    transferBonus?: string;
    taxes: number;
  };
  cashOption?: {
    estimatedPrice: number;
    fareClass: string;
  };
  recommendation: string;
  whyThisFlight: string;
}

export interface ItineraryHotelRecommendation {
  destination: string;
  hotelName: string;
  hotelType: string;
  starRating: number;
  neighborhood: string;
  checkIn: string;
  checkOut: string;
  nightCount: number;
  pointsOption?: {
    program: string;
    pointsPerNight: number;
    totalPoints: number;
    transferFrom?: string;
  };
  cashOption?: {
    estimatedPerNight: number;
    estimatedTotal: number;
  };
  highlights: string[];
  whyThisHotel: string;
}

export interface ItineraryBudgetBreakdown {
  totalEstimatedCash: number;
  totalPointsUsed: { program: string; points: number }[];
  flightsCash: number;
  flightsPoints: string;
  hotelsCash: number;
  hotelsPoints: string;
  savings: string;
}

// Per-traveler hotel search results
export interface ScoredHotel {
  hotel: MergedHotelResult;
  compositeScore: number;
  valueScore: number;
  locationScore: number;
  loyaltyScore: number;
  preferenceScore: number;
  qualityScore: number;
  rationale: string;
  paymentRecommendation: "points" | "cash" | "mixed";
  highlights: string[];
  cppValue?: number;
  estimatedSavings?: number;
}

export interface MergedHotelResult {
  hotelId: string;
  name: string;
  destination: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  cashPerNight: number | null;
  cashTotal: number | null;
  awardOption?: {
    program: string;
    programDisplayName: string;
    pointsPerNight: number;
    pointsTotal: number;
    surcharge: number;
    category?: number;
    transferSources: {
      bank: string;
      bankDisplayName: string;
      ratio: number;
      transferTime: string;
    }[];
  };
  starRating?: number;
  overallRating?: number;
  neighborhood?: string;
  amenities: string[];
  thumbnailUrl?: string;
  bookingUrl?: string;
  cppValue?: number;
}

export interface HotelStayGroup {
  destination: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  cashOptions: unknown[];
  awardOptions: unknown[];
  scoredOptions?: ScoredHotel[];
}

export interface TravelerHotelGroup {
  travelerId: string;
  travelerName: string;
  clientId: string;
  stays: HotelStayGroup[];
}

export interface GeneratedItinerary {
  summary: string;
  flights: ItineraryFlightRecommendation[];
  hotels: ItineraryHotelRecommendation[];
  budgetBreakdown: ItineraryBudgetBreakdown;
  pointsStrategy: string;
  tips: string[];
  travelerFlights?: TravelerFlightGroup[];
  travelerHotels?: TravelerHotelGroup[];
}

// Per-traveler real flight search results
export interface TravelerFlightGroup {
  travelerId: string;
  travelerName: string;
  clientId: string;
  segments: TravelerFlightSegment[];
}

export interface TravelerFlightSegment {
  segmentLabel: string;
  origin: string;
  destination: string;
  date: string;
  cashOptions: CashFlightOption[];
  awardOptions: AwardFlightOption[];
}

export interface CashFlightOption {
  airline: string;
  airlineLogo?: string;
  flightNumber: string;
  departureAirport: string;
  departureTime: string;
  arrivalAirport: string;
  arrivalTime: string;
  duration: number;
  stops: number;
  layovers: { airport: string; durationMin: number }[];
  price: number;
  fareClass: string;
  cabin: string;
  hasCarrierChange?: boolean;
  isRedeye?: boolean;
  score?: number;
}

export interface AwardFlightOption {
  source: string;
  origin: string;
  destination: string;
  date: string;
  cabin: string;
  milesRequired: number;
  taxes: number;
  seatsRemaining?: number;
  isDirect: boolean;
  airlines?: string;
  program: string;
  cppValue?: number;
  score?: number;
  transferSource?: string;
}

interface ItineraryJobStartResult {
  status: 'processing';
  jobId: string;
}

interface ItineraryStatusResult {
  status: 'processing' | 'complete' | 'failed';
  result?: GeneratedItinerary;
  partialResult?: Partial<GeneratedItinerary>;
  completedSections?: string[];
  pendingSections?: string[];
  error?: string;
}

export interface ItineraryProgressUpdate {
  partialItinerary: Partial<GeneratedItinerary>;
  completedSections: string[];
  pendingSections: string[];
}

interface SavedItineraryResult {
  exists: boolean;
  result: GeneratedItinerary | null;
}

export async function getSavedItinerary(
  tripId: string,
): Promise<GeneratedItinerary | null> {
  const data = await apiFetch<SavedItineraryResult>(
    `/trip-requests/${tripId}/generate-itinerary`,
  );
  return data.exists ? data.result : null;
}

export async function generateTripItinerary(
  tripId: string,
  onProgress?: (update: ItineraryProgressUpdate) => void,
): Promise<GeneratedItinerary> {
  const start = await apiFetch<ItineraryJobStartResult>(
    `/trip-requests/${tripId}/generate-itinerary`,
    { method: 'POST' },
  );

  if (!start.jobId) {
    throw new Error('Server did not return a job ID');
  }

  const maxWaitMs = 120_000;
  const pollIntervalMs = 2_000;
  const deadline = Date.now() + maxWaitMs;
  let lastSectionCount = 0;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const status = await apiFetch<ItineraryStatusResult>(
      `/trip-requests/${tripId}/generate-itinerary/status?jobId=${start.jobId}`,
    );

    if (status.status === 'complete') {
      if (!status.result) throw new Error('No itinerary returned from server');
      return status.result;
    }

    if (status.status === 'failed') {
      throw new Error(status.error || 'Itinerary generation failed on the server');
    }

    const completed = status.completedSections ?? [];
    const pending = status.pendingSections ?? [];
    if (onProgress && status.partialResult && completed.length > lastSectionCount) {
      lastSectionCount = completed.length;
      const { _completedSections, _pendingSections, ...cleanPartial } =
        status.partialResult as Partial<GeneratedItinerary> & Record<string, unknown>;
      onProgress({
        partialItinerary: cleanPartial as Partial<GeneratedItinerary>,
        completedSections: completed,
        pendingSections: pending,
      });
    }
  }

  throw new Error('Itinerary generation timed out — please try again');
}

// ---------------------------------------------------------------------------
// Flight Search
// ---------------------------------------------------------------------------

interface FlightSearchResult {
  travelerFlights: TravelerFlightGroup[];
}

export async function searchTripFlights(tripId: string): Promise<TravelerFlightGroup[]> {
  const res = await apiFetch<FlightSearchResult>(
    `/trip-requests/${tripId}/search-flights`,
    { method: 'POST' },
  );
  return res.travelerFlights || [];
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

export interface IntakeChatMessage {
  role: 'assistant' | 'advisor';
  content: string;
  timestamp: string;
}

export interface IntakeChatStartResponse {
  sessionId: string;
  messages: IntakeChatMessage[];
}

export interface IntakeChatMessageResponse {
  message: IntakeChatMessage;
}

export function startIntakeChat(
  clientId: string,
  intakeId: string,
  intakeData: Record<string, unknown>,
) {
  return apiFetch<IntakeChatStartResponse>(
    `/clients/${clientId}/intakes/${intakeId}/chat/start`,
    {
      method: 'POST',
      body: JSON.stringify({ intakeData }),
    },
  );
}

export function sendIntakeChatMessage(
  clientId: string,
  intakeId: string,
  payload: {
    advisorMessage: string;
    messageHistory: IntakeChatMessage[];
    intakeData: Record<string, unknown>;
  },
) {
  return apiFetch<IntakeChatMessageResponse>(
    `/clients/${clientId}/intakes/${intakeId}/chat/message`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
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

export function getReminders(params?: { status?: string; dueBefore?: string; clientId?: string }) {
  const sp = new URLSearchParams();
  if (params?.status) sp.set('status', params.status);
  if (params?.dueBefore) sp.set('dueBefore', params.dueBefore);
  if (params?.clientId) sp.set('clientId', params.clientId);
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

export function getOperationsDashboard(clientId?: string) {
  const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
  return apiFetch<OperationsDashboardData>(`/operations/dashboard${qs}`);
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
  return apiFetch<MeetingEntryWithExtractions>(`/clients/${clientId}/meetings/${meetingId}/entries`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateMeetingEntry(
  clientId: string,
  meetingId: string,
  entryId: string,
  content: string,
) {
  return apiFetch<MeetingEntryWithExtractions>(`/clients/${clientId}/meetings/${meetingId}/entries`, {
    method: 'PATCH',
    body: JSON.stringify({ entryId, content }),
  });
}

export function generateMeetingQuestions(
  clientId: string,
  meetingId: string,
  options?: { followUp?: boolean; answeredQuestions?: AnsweredQuestionPayload[] },
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

// ---------------------------------------------------------------------------
// Group Travel Optimization & Settlement
// ---------------------------------------------------------------------------

export interface GroupSegmentAssignment {
  segmentId: string;
  segmentLabel: string;
  travelerId: string;
  travelerName: string;
  paymentType: 'cash' | 'points' | 'mixed';
  cashAmount: number;
  pointsUsed: number;
  pointsProgram: string | null;
  pointsProgramName: string | null;
  pointsOwnerId: string;
  pointsOwnerName: string;
  transferFrom?: string;
  transferFromName?: string;
  transferPointsNeeded?: number;
  transferRatio?: number;
  cppAchieved: number;
}

export interface GroupAllocationResult {
  assignments: GroupSegmentAssignment[];
  totalCashCost: number;
  totalCashBaseline: number;
  cashSavedVsAllCash: number;
  savingsPercent: number;
}

export interface SettlementContribution {
  travelerId: string;
  travelerName: string;
  cashPaid: number;
  pointsContributed: {
    program: string;
    programName: string;
    points: number;
    valueCents: number;
    usedForTravelerId: string;
    usedForTravelerName: string;
    usedForSegmentId: string;
    usedForSegmentLabel: string;
  }[];
  totalContributionCents: number;
}

export interface SettlementFairShare {
  travelerId: string;
  travelerName: string;
  fairShareCents: number;
  segmentBreakdown: { segmentId: string; segmentLabel: string; cashEquivalent: number }[];
}

export interface SettlementTransferItem {
  fromTravelerId: string;
  fromName: string;
  toTravelerId: string;
  toName: string;
  amountCents: number;
  reason: string;
  breakdown: string[];
}

export interface SettlementResult {
  contributions: SettlementContribution[];
  fairShares: SettlementFairShare[];
  transfers: SettlementTransferItem[];
  memo: string;
}

export interface GroupOptimizeResult {
  allocation: GroupAllocationResult;
  settlement: SettlementResult;
}

export interface GroupSettlementRecord {
  id: string;
  tripRequestId: string;
  splitMethod: string;
  pointValuationMethod: string;
  contributions: SettlementContribution[];
  fairShares: SettlementFairShare[];
  transfers: SettlementTransferItem[];
  memo: string;
  createdAt: string;
}

export function runGroupOptimization(
  tripId: string,
  options?: {
    splitMethod?: 'equal' | 'proportional_to_cost' | 'custom';
    waivedTravelerIds?: string[];
  },
) {
  return apiFetch<GroupOptimizeResult>(`/trip-requests/${tripId}/group-optimize`, {
    method: 'POST',
    body: JSON.stringify(options ?? {}),
  });
}

export function getGroupSettlement(tripId: string) {
  return apiFetch<GroupSettlementRecord>(`/trip-requests/${tripId}/settlement`);
}

export function updateGroupSettlement(
  tripId: string,
  payload: {
    splitMethod?: 'equal' | 'proportional_to_cost' | 'custom';
    pointValuationMethod?: 'actual_redemption' | 'benchmark_cpp' | 'tpg_market';
    memo?: string;
  },
) {
  return apiFetch<Partial<GroupSettlementRecord>>(`/trip-requests/${tripId}/settlement`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Group Profile
// ---------------------------------------------------------------------------

export type GroupType =
  | 'leisure_friends'
  | 'destination_wedding'
  | 'family_reunion'
  | 'corporate_offsite'
  | 'multi_generational'
  | 'other';

export type GroupDecisionStyle = 'organizer_decides' | 'consensus' | 'advisor_recommends';

export interface GroupMember {
  id: string;
  groupProfileId: string;
  linkedClientId?: string;
  linkedClient?: LinkedClientSummary;
  name: string;
  email?: string;
  departureCity?: string;
  isOrganizer: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupProfile {
  id: string;
  clientId: string;
  groupType: GroupType;
  estimatedSize?: number;
  ageSpread?: string;
  decisionStyle: GroupDecisionStyle;
  roomArrangement?: string;
  sharedBilling: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  members?: GroupMember[];
}

export interface GroupProfilePayload {
  groupType: GroupType;
  estimatedSize?: number;
  ageSpread?: string;
  decisionStyle: GroupDecisionStyle;
  roomArrangement?: string;
  sharedBilling?: boolean;
  notes?: string;
}

export interface GroupMemberPayload {
  linkedClientId?: string;
  name?: string;
  email?: string;
  departureCity?: string;
  isOrganizer?: boolean;
  notes?: string;
}

export function getGroupProfile(clientId: string) {
  return apiFetch<GroupProfile | null>(`/clients/${clientId}/group-profile`);
}

export function upsertGroupProfile(clientId: string, payload: Partial<GroupProfilePayload>) {
  return apiFetch<GroupProfile>(`/clients/${clientId}/group-profile`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function getGroupMembers(clientId: string) {
  return apiFetch<GroupMember[]>(`/clients/${clientId}/group-members`);
}

export function addGroupMember(clientId: string, payload: GroupMemberPayload) {
  return apiFetch<GroupMember>(`/clients/${clientId}/group-members`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateGroupMember(clientId: string, memberId: string, payload: Partial<GroupMemberPayload>) {
  return apiFetch<GroupMember>(`/clients/${clientId}/group-members/${memberId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function removeGroupMember(clientId: string, memberId: string) {
  return apiFetch<void>(`/clients/${clientId}/group-members/${memberId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Business Profile
// ---------------------------------------------------------------------------

export interface BusinessTraveler {
  id: string;
  businessProfileId: string;
  linkedClientId?: string;
  linkedClient?: LinkedClientSummary;
  name: string;
  email?: string;
  role?: string;
  seniorityTier?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessProfile {
  id: string;
  clientId: string;
  companyName: string;
  industry?: string;
  companySize?: string;
  billingContactName?: string;
  billingContactEmail?: string;
  requiresPreApproval: boolean;
  maxNightlyRateUsd?: number;
  travelPolicyNotes?: string;
  corporateAccountIds?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  travelers?: BusinessTraveler[];
}

export interface BusinessProfilePayload {
  companyName: string;
  industry?: string;
  companySize?: string;
  billingContactName?: string;
  billingContactEmail?: string;
  requiresPreApproval?: boolean;
  maxNightlyRateUsd?: number;
  travelPolicyNotes?: string;
  corporateAccountIds?: Record<string, string>;
}

export interface BusinessTravelerPayload {
  linkedClientId?: string;
  name?: string;
  email?: string;
  role?: string;
  seniorityTier?: string;
  notes?: string;
}

export function getBusinessProfile(clientId: string) {
  return apiFetch<BusinessProfile | null>(`/clients/${clientId}/business-profile`);
}

export function upsertBusinessProfile(clientId: string, payload: Partial<BusinessProfilePayload>) {
  return apiFetch<BusinessProfile>(`/clients/${clientId}/business-profile`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function getBusinessTravelers(clientId: string) {
  return apiFetch<BusinessTraveler[]>(`/clients/${clientId}/business-travelers`);
}

export function addBusinessTraveler(clientId: string, payload: BusinessTravelerPayload) {
  return apiFetch<BusinessTraveler>(`/clients/${clientId}/business-travelers`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateBusinessTraveler(clientId: string, travelerId: string, payload: Partial<BusinessTravelerPayload>) {
  return apiFetch<BusinessTraveler>(`/clients/${clientId}/business-travelers/${travelerId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function removeBusinessTraveler(clientId: string, travelerId: string) {
  return apiFetch<void>(`/clients/${clientId}/business-travelers/${travelerId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Intake Invitations
// ---------------------------------------------------------------------------

export type IntakeFormVariant =
  | 'individual'
  | 'group_member'
  | 'group_organizer'
  | 'business_policy'
  | 'business_traveler';

export type IntakeInvitationStatus = 'pending' | 'opened' | 'completed' | 'expired';

export interface IntakeInvitation {
  id: string;
  token: string;
  clientId: string;
  intakeId?: string;
  recipientEmail: string;
  recipientName?: string;
  formVariant: IntakeFormVariant;
  groupSize?: number;
  sentAt?: string;
  openedAt?: string;
  completedAt?: string;
  expiresAt: string;
  reminderSentAt?: string;
  createdAt: string;
  status: IntakeInvitationStatus;
}

export interface IntakeInvitationRecipient {
  email: string;
  name?: string;
  formVariant: IntakeFormVariant;
  groupSize?: number;
}

export function getIntakeInvitations(clientId: string) {
  return apiFetch<IntakeInvitation[]>(`/clients/${clientId}/intake-invitations`);
}

export function sendIntakeInvitations(
  clientId: string,
  recipients: IntakeInvitationRecipient[],
  expiresInDays = 14,
) {
  return apiFetch<IntakeInvitation[]>(`/clients/${clientId}/intake-invitations`, {
    method: 'POST',
    body: JSON.stringify({ recipients, expiresInDays }),
  });
}

export function sendGroupBatchInvitations(
  clientId: string,
  payload: {
    organizerEmail: string;
    organizerName?: string;
    members: Array<{ email: string; name?: string }>;
    groupSize: number;
    expiresInDays?: number;
  },
) {
  return apiFetch<IntakeInvitation[]>(`/clients/${clientId}/intake-invitations/group-batch`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function resendIntakeInvitation(tokenId: string) {
  return apiFetch<IntakeInvitation>(`/intake-invitations/${tokenId}`, { method: 'POST' });
}

export function revokeIntakeInvitation(tokenId: string) {
  return apiFetch<void>(`/intake-invitations/${tokenId}`, { method: 'DELETE' });
}
