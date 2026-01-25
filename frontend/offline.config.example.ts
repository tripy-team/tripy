/**
 * Offline Mode Configuration Example
 * 
 * To enable offline mode locally:
 * 1. Copy this file: cp offline.config.example.ts offline.config.ts
 * 2. Set ENABLE_OFFLINE_MODE = true
 * 
 * Note: offline.config.ts is gitignored and won't be committed
 */

// Set to true to enable offline mode (skip auth, use mock data)
// Set to false to use real API calls with authentication
export const ENABLE_OFFLINE_MODE = false;
