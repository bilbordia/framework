// Export all types from the types package
export * from './auth.types';
export * from './subscription.types';
export * from './theme.types';
export * from './route.types';
export * from './api.types';
export * from './ai.types';
export * from './platform.types';
export * from './analytics.types';
export * from './email.types';
export * from './notification.types';
export * from './navigation.types';
export * from './organizations.types'; // This now exports all org+store types
export * from './logger.types';
export * from './supabase.types';
export * from './services/payment.types'; // [NEW] Tokenomics Payment Types
export * from './services/tokenWallet.types'; // [NEW] Tokenomics Wallet Types
export * from './ai.SendMessage.types';
export * from './dialectic.types';

// Export Json type if it's defined elsewhere or define basic alias
// If Json is complex and defined in its own file (e.g., json.types.ts), export that:
// export * from './json.types'; 
// Otherwise, a simple alias might suffice if not already defined:
export type Json = 
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// Ensure vite-env types are handled if needed, maybe not exported directly
// /// <reference types="vite/client" />

// Re-export the Vite environment types (they're ambient declarations)
export {};

// This file serves as a reference to vite-env.d.ts which provides ambient declarations
// for import.meta.env across all packages

// [NEW] Notification Types
// export interface Notification {
//   id: string; // UUID
//   user_id: string; // UUID
//   type: string; // e.g., 'join_request', 'invite_sent'
//   data?: Record<string, any> | null; // Stores context like target_path, org_id, etc.
//   read: boolean;
//   created_at: string; // ISO timestamp string
// }

// [NEW] Add Notification related types to ApiClient interface if defined, or create specific interfaces
// export interface NotificationApiClientInterface { ... }