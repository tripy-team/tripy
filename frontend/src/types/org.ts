export interface BrandingSettings {
  brandName?: string;
  brandColor?: string;
  logoUrl?: string;
}

export interface Organization {
  orgId: string;
  name: string;
  ownerId: string;
  plan: string;
  trialEndsAt?: string;
  branding?: BrandingSettings;
  createdAt: string;
}

export interface OrgMember {
  orgId: string;
  userId: string;
  role: 'owner' | 'member';
  email?: string;
  name?: string;
  createdAt: string;
}

export interface ClientPreferences {
  flightClass?: string;
  seatPreference?: string;
  airlines?: string[];
  notes?: string;
}

export interface ClientStats {
  totalTrips: number;
  totalSavings: number;
  totalPointsOptimized: number;
}

export interface Client {
  orgId: string;
  clientId: string;
  name: string;
  email?: string;
  homeAirport?: string;
  notes?: string;
  preferences?: ClientPreferences;
  stats?: ClientStats;
  isSelfClient: boolean;
  createdBy?: string;
  createdAt: string;
}

export interface ClientPointsBalance {
  program: string;
  balance: number;
  updatedAt?: string;
  updatedBy?: string;
}

export interface CreateClientRequest {
  name: string;
  email?: string;
  homeAirport?: string;
  notes?: string;
  preferences?: ClientPreferences;
  initialPoints?: ClientPointsBalance[];
}

export interface UpdateClientRequest {
  name?: string;
  email?: string;
  homeAirport?: string;
  notes?: string;
  preferences?: ClientPreferences;
}
