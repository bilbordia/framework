import { vi } from 'vitest';
import { 
  ApiResponse, 
  TokenWallet, 
  TokenWalletTransaction, 
  PaymentInitiationResult, 
  PurchaseRequest, 
} from '@paynless/types';
import { createMockAiApiClient, resetMockAiApiClient, type MockedAiApiClient } from './ai.api.mock';
import { createMockDialecticClient, resetMockDialecticClient, type MockDialecticApiClient } from './dialectic.api.mock';

// Define the type for the object returned by api.wallet()
export type MockWalletApiClient = {
  getWalletInfo: ReturnType<typeof vi.fn<[organizationId?: string | null | undefined], Promise<ApiResponse<TokenWallet | null>>>>;
  getWalletTransactionHistory: ReturnType<typeof vi.fn<[organizationId?: string | null | undefined, limit?: number | undefined, offset?: number | undefined], Promise<ApiResponse<TokenWalletTransaction[]>>>>;
  initiateTokenPurchase: ReturnType<typeof vi.fn<[request: PurchaseRequest], Promise<ApiResponse<PaymentInitiationResult | null>>>>;
};

// --- AI Client Mock Setup ---
let mockAiClientInstance: MockedAiApiClient = createMockAiApiClient();
let mockDialecticClientInstance: MockDialecticApiClient = createMockDialecticClient();

// Define the type for the main mocked api object
export type MockApi = {
  wallet: ReturnType<typeof vi.fn<[], MockWalletApiClient>>;
  ai: ReturnType<typeof vi.fn<[], MockedAiApiClient>>; // Added ai client
  dialectic: ReturnType<typeof vi.fn<[], MockDialecticApiClient>>;
};

// Create the actual mock functions for the wallet client
const mockWalletClientInstance: MockWalletApiClient = {
  getWalletInfo: vi.fn(),
  getWalletTransactionHistory: vi.fn(),
  initiateTokenPurchase: vi.fn(),
};

// The main mocked api object that will be imported by tests
export const api: MockApi = {
  wallet: vi.fn(() => mockWalletClientInstance),
  ai: vi.fn(() => mockAiClientInstance), // Ensure api.ai() returns our mock AI client instance
  dialectic: vi.fn(() => mockDialecticClientInstance),
};

/**
 * Resets all nested mock functions in the mocked api object.
 * Call this in your test setup (e.g., beforeEach) to ensure clean state between tests.
 */
export function resetApiMock() {
  // Reset the functions on the instance returned by api.wallet()
  mockWalletClientInstance.getWalletInfo.mockReset();
  mockWalletClientInstance.getWalletTransactionHistory.mockReset();
  mockWalletClientInstance.initiateTokenPurchase.mockReset();

  // Re-create the mock instances to ensure they are fresh.
  mockAiClientInstance = createMockAiApiClient();
  resetMockAiApiClient(mockAiClientInstance); 

  mockDialecticClientInstance = createMockDialecticClient();
  resetMockDialecticClient(mockDialecticClientInstance);
  
  // Reset the main accessor mocks
  api.wallet.mockClear();
  api.ai.mockClear();
  api.dialectic.mockClear();

  // Restore the default implementations to return the (potentially recreated) instances
  api.wallet.mockImplementation(() => mockWalletClientInstance);
  api.ai.mockImplementation(() => mockAiClientInstance);
  api.dialectic.mockImplementation(() => mockDialecticClientInstance);
}

/**
 * Helper to get the current instance of the mock AI client.
 * Useful for tests to access specific mock functions like sendChatMessage.
 */
export const getMockAiClient = (): MockedAiApiClient => mockAiClientInstance;
export const getMockDialecticClient = (): MockDialecticApiClient => mockDialecticClientInstance;

// Make sure 'api' is exported and is the mockApiObject
// ... existing code ... 