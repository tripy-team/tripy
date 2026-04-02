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

export interface Client {
  id: string;
  orgId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dateOfBirth?: string;
  notes?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  balancesCount?: number;
  householdsCount?: number;
}

export interface ClientCreatePayload {
  firstName: string;
  lastName: string;
  email: string;
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

export interface ClientPreference {
  id: string;
  clientId: string;
  cabinPreference?: string;
  redemptionStyle?: string;
  preferNonstop?: boolean;
  preferredAirlines?: string[];
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

export interface DashboardData {
  totalClients: number;
  totalHouseholds: number;
  expiringPointsNext30Days: number;
  activeTransferBonuses: number;
  activeTripAnalyses: TripRequest[];
  recentAlerts: AlertEvent[];
  advisorName: string;
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

export function updateClientPreferences(clientId: string, payload: Partial<ClientPreference>) {
  return apiFetch<ClientPreference>(`/clients/${clientId}/preferences`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Households
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

export function analyzeTripRequest(tripId: string) {
  return apiFetch<RecommendationRunSummary>(`/trip-requests/${tripId}/analyze`, {
    method: 'POST',
  });
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
