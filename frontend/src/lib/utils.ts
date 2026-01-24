// Simplified utilities - all in one file

// Validation
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain a number';
  return null;
}

// Formatting
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPoints(points: number): string {
  return new Intl.NumberFormat('en-US').format(points);
}

export function formatDate(date: Date | string): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(dateObj);
}

export function formatDateRange(startDate: Date | string, endDate: Date | string): string {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate;

  const startStr = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(start);
  const endStr = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(end);

  return `${startStr} - ${endStr}`;
}

// Trip helpers
export function generateTripTitle(cities: string[], tripType: 'solo' | 'group'): string {
  if (cities.length === 0) return `${tripType === 'solo' ? 'Solo' : 'Group'} Trip`;
  if (cities.length === 1) return `${tripType === 'solo' ? 'Solo' : 'Group'} Trip to ${cities[0]}`;
  if (cities.length === 2) return `${tripType === 'solo' ? 'Solo' : 'Group'} Trip to ${cities[0]} & ${cities[1]}`;
  return `${tripType === 'solo' ? 'Solo' : 'Group'} Trip to ${cities[0]} & ${cities.length - 1} more`;
}

/**
 * Format a list of destinations into a short, readable summary (e.g. for trip configuration).
 * Examples: "Paris", "Paris & Rome", "Paris, Rome & Barcelona", "Paris, Rome, Barcelona & 2 more"
 */
export function formatDestinationsSummary(destinations: string[]): string {
  const d = (destinations || []).filter(Boolean).map((s) => String(s).trim()).filter(Boolean);
  if (d.length === 0) return '—';
  if (d.length === 1) return d[0];
  if (d.length === 2) return `${d[0]} & ${d[1]}`;
  if (d.length === 3) return `${d[0]}, ${d[1]} & ${d[2]}`;
  return `${d[0]}, ${d[1]}, ${d[2]} & ${d.length - 3} more`;
}

/**
 * Compute trip duration in days from start and end dates (YYYY-MM-DD). Returns null if invalid.
 */
export function tripDurationDays(startDate: string, endDate: string): number | null {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const ms = end.getTime() - start.getTime();
  const days = Math.round(ms / (24 * 60 * 60 * 1000)) + 1;
  return days > 0 ? days : null;
}
