# AI Chat Enhancements: PARENTHESIS Implementation Plan

## Preamble

This document outlines the detailed, step-by-step implementation plan for the AI Chat Enhancements project, based on the synthesized requirements (SYNTHESIS #1, #2, #3) and user feedback. It follows a Test-Driven Development (TDD) approach (Red -> Green -> Refactor) and adheres to the existing monorepo architecture (`Backend (Supabase Functions) <-> API Client (@paynless/api) <-> State (@paynless/store) <-> Frontend (apps/web)`).

**Goal:** To guide the development team through the implementation process, ensuring all requirements are met, code quality is maintained, and features are delivered reliably.

## Legend

*   [ ] Each work step will be uniquely named for easy reference 
    *   [ ] Worksteps will be nested as shown
        *   [ ] Nesting can be as deep as logically required 
*   [✅] Represents a completed step or nested set
*   [🚧] Represents an incomplete or partially completed step or nested set
*   [⏸️] Represents a paused step where a discovery has been made that requires backtracking 
*   [❓] Represents an uncertainty that must be resolved before continuing 
*   [🚫] Represents a blocked, halted, stopped step or nested set that has some unresolved problem or prior dependency to resolve before continuing

## Component Types and Labels

The implementation plan uses the following labels to categorize work steps:

* **[DB]:** Database Schema Change (Migration)
* **[RLS]:** Row-Level Security Policy
* **[BE]:** Backend Logic (Edge Function / RLS / Helpers)
* **[API]:** API Client Library (`@paynless/api`)
* **[STORE]:** State Management (`@paynless/store`)
* **[UI]:** Frontend Component (`apps/web`)
* **[TEST-UNIT]:** Unit Test Implementation/Update
* **[TEST-INT]:** Integration Test Implementation/Update (API, Store-Component, RLS)
* **[ANALYTICS]:** Analytics Integration (`@paynless/analytics`)
* **[REFACTOR]:** Code Refactoring Step
* **[COMMIT]:** Checkpoint for Git Commit

**Core Principles:**

*   **TDD:** Write failing tests before implementation code (RED), write code to make tests pass (GREEN), then refactor (REFACTOR).
*   **Modularity:** Build reusable components, functions, and modules.
*   **Architecture:** Respect the existing API <-> Store <-> UI flow and the `api` Singleton pattern.
*   **Explicitness:** Leave nothing to assumption. Detail every sub-step.
*   **Testing:** Unit tests (`[TEST-UNIT]`) for isolated logic, Integration tests (`[TEST-INT]`) for interactions (API-Store, Store-UI, Backend Endpoints). E2E tests (`[TEST-E2E]`) are optional/manual for this phase.
*   **Analytics:** Integrate `packages/analytics` for all relevant user interactions (`[ANALYTICS]`)
*   **Commits:** Commit frequently after Green/Refactor stages with clear messages (`[COMMIT]`)
*   **Checkpoints:** Stop, run tests (`npm test`), build (`npm run build`), restart dev server after significant steps/phases.

**Reference Requirements:** Use REQ-XXX codes from SYNTHESIS #2 PRD for traceability.

# Phase 4: Advanced Tokenomics - Wallets, Payments, and Auditing

**Overall Goal:** Implement a robust and extensible system for managing AI token wallets, allowing users to acquire tokens through various payment gateways (fiat and crypto), consume tokens for AI services, and provide a clear audit trail. This system will be built with abstractions to easily integrate new payment methods and potential future exchange functionalities.

**Legend:**
*   **[DB]:** Database
*   **[RLS]:** Row-Level Security
*   **[BE]:** Backend Logic (Edge Function / Services / Helpers)
*   **[TYPES]:** Shared Types (`@paynless/types`)
*   **[API]:** API Client (`@paynless/api`)
*   **[STORE]:** State Management (`@paynless/store`)
*   **[UI]:** Frontend Component/Hook (`apps/web`)
*   **[TEST-UNIT]:** Unit Test
*   **[TEST-INT]:** Integration Test
*   **[REFACTOR]:** Refactoring
*   **[COMMIT]:** Git Commit Point
*   **[ARCH]:** Architecture & Design

---

## Phase 4.0: [ARCH] Foundational Abstractions & Core Ledger Design

**Goal:** Define the core interfaces and database structures for a flexible token wallet and payment system.

*   [✅] **4.0.1: [TYPES] Define Core Service Interfaces**
    *   `packages/types/src/services/payment.types.ts` (new):
        *   `PurchaseRequest`: `{ userId: string; organizationId?: string | null; itemId: string; /* e.g., package_1000_tokens */ quantity: number; currency: string; /* e.g., USD, ETH */ paymentGatewayId: string; /* e.g., 'stripe', 'coinbase', 'internal_tauri_wallet' */ metadata?: Record<string, any>; }`
        *   `PaymentInitiationResult`: `{ success: boolean; transactionId?: string; /* Our internal payment_transactions.id */ paymentGatewayTransactionId?: string; /* Stripe's session_id, etc. */ redirectUrl?: string; clientSecret?: string; /* For Stripe Elements */ error?: string; }`
        *   `PaymentConfirmation`: `{ success: boolean; transactionId: string; tokensAwarded?: number; error?: string; }`
        *   `IPaymentGatewayAdapter`: `{ gatewayId: string; initiatePayment(request: PurchaseRequest): Promise<PaymentInitiationResult>; handleWebhook(payload: any, headers?: any): Promise<PaymentConfirmation>; /* headers for signature verification */ }`
    *   `packages/types/src/services/tokenWallet.types.ts` (new):
        *   `TokenWallet`: `{ walletId: string; userId?: string; organizationId?: string; balance: string; /* Using string for BigInt precision via NUMERIC */ currency: 'AI_TOKEN'; createdAt: Date; updatedAt: Date; }`
        *   `TokenWalletTransactionType`: `'CREDIT_PURCHASE' | 'CREDIT_ADJUSTMENT' | 'CREDIT_REFERRAL' | 'DEBIT_USAGE' | 'DEBIT_ADJUSTMENT' | 'TRANSFER_IN' | 'TRANSFER_OUT'`
        *   `TokenWalletTransaction`: `{ transactionId: string; walletId: string; type: TokenWalletTransactionType; amount: string; /* BigInt via NUMERIC */ balanceAfterTxn: string; /* BigInt via NUMERIC */ relatedEntityId?: string; /* e.g., chatMessageId, paymentTransactionId, referredUserId */ relatedEntityType?: string; notes?: string; timestamp: Date; }`
        *   `ITokenWalletService`: `{ createWallet(userId?: string, organizationId?: string): Promise<TokenWallet>; getWallet(walletId: string): Promise<TokenWallet | null>; getWalletForContext(userId?: string, organizationId?: string): Promise<TokenWallet | null>; getBalance(walletId: string): Promise<string>; recordTransaction(params: { walletId: string; type: TokenWalletTransactionType; amount: string; relatedEntityId?: string; relatedEntityType?: string; notes?: string; }): Promise<TokenWalletTransaction>; checkBalance(walletId: string, amountToSpend: string): Promise<boolean>; getTransactionHistory(walletId: string, limit?: number, offset?: number): Promise<TokenWalletTransaction[]>; }`
*   [✅] **4.0.2: [DB] Design Core Token Ledger Tables**
    *   `token_wallets` table: `wallet_id (PK UUID DEFAULT gen_random_uuid())`, `user_id (FK to public.users(id) ON DELETE CASCADE, NULLABLE)`, `organization_id (FK to public.organizations(id) ON DELETE CASCADE, NULLABLE)`, `balance (NUMERIC(19,0) NOT NULL DEFAULT 0)`, `currency (VARCHAR(10) NOT NULL DEFAULT 'AI_TOKEN')`, `created_at (TIMESTAMPTZ DEFAULT NOW())`, `updated_at (TIMESTAMPTZ DEFAULT NOW())`. `CONSTRAINT user_or_org_wallet CHECK ((user_id IS NOT NULL AND organization_id IS NULL) OR (user_id IS NULL AND organization_id IS NOT NULL) OR (user_id IS NOT NULL AND organization_id IS NOT NULL))`. Add unique constraint on `(user_id)` where `organization_id IS NULL`, and on `(organization_id)` where `user_id IS NULL`.
    *   `token_wallet_transactions` table (Ledger): `transaction_id (PK UUID DEFAULT gen_random_uuid())`, `wallet_id (FK to token_wallets(wallet_id) ON DELETE CASCADE, NOT NULL)`, `transaction_type (VARCHAR(50) NOT NULL)`, `amount (NUMERIC(19,0) NOT NULL)`, `balance_after_txn (NUMERIC(19,0) NOT NULL)`, `related_entity_id (VARCHAR(255), NULLABLE)`, `related_entity_type (VARCHAR(50), NULLABLE)`, `notes (TEXT, NULLABLE)`, `idempotency_key (VARCHAR(255) UNIQUE, NULLABLE)`, `timestamp (TIMESTAMPTZ DEFAULT NOW())`. Index on `(wallet_id, timestamp DESC)`.
    *   `payment_transactions` table: `id (PK UUID DEFAULT gen_random_uuid())`, `user_id (FK to public.users(id), NULLABLE)`, `organization_id (FK to public.organizations(id), NULLABLE)`, `target_wallet_id (FK to token_wallets(wallet_id) NOT NULL)`, `payment_gateway_id (VARCHAR(50) NOT NULL)`, `gateway_transaction_id (VARCHAR(255), NULLABLE, UNIQUE)`, `status (VARCHAR(20) NOT NULL DEFAULT 'PENDING')`, `amount_requested_fiat (NUMERIC(10,2), NULLABLE)`, `currency_requested_fiat (VARCHAR(3), NULLABLE)`, `amount_requested_crypto (NUMERIC(36,18), NULLABLE)`, `currency_requested_crypto (VARCHAR(10), NULLABLE)`, `tokens_to_award (NUMERIC(19,0) NOT NULL)`, `metadata_json (JSONB, NULLABLE)`, `created_at (TIMESTAMPTZ DEFAULT NOW())`, `updated_at (TIMESTAMPTZ DEFAULT NOW())`.
*   [✅] **4.0.3: [DB] Create Migration Scripts for New Tables.** Include `CREATE TRIGGER update_wallet_balance_and_log_txn BEFORE INSERT ON token_wallet_transactions` for atomicity or handle in service layer with DB transaction. (Prefer service layer transaction). Also `CREATE TRIGGER set_public_updated_at BEFORE UPDATE ON each_table`.
*   [✅] **4.0.4: [DB] Apply Migrations & Verify.**
*   [✅] **4.0.5: [COMMIT]** "feat(DB|TYPES): Design foundational abstractions and schema for token wallets & payments"

---

## Phase 4.1: [BE] Core Wallet Service & Payment Gateway Integration

**Goal:** Implement the backend service for managing token wallets and integrate the first payment gateway (Stripe).

### 4.1.1: [BE] Implement `TokenWalletService`
*   [🚧] **4.1.1.1: [BE] [TEST-UNIT] Implement and Test `TokenWalletService` Methods using TDD**
    *   **Overall Prerequisites (ensure these are addressed before or during relevant TDD cycles below):**
        *   Task `4.1.1.1a` (Enhance `recorded_by_user_id` for Full Auditability) and its sub-tasks are critical, especially for `recordTransaction`.
            *   [✅] **4.1.1.1a.1: [DB] Make `recorded_by_user_id` mandatory.** (Completed for `token_wallet_transactions` table and PG function `record_token_transaction`)
            *   [✅] **4.1.1.1a.2: [TYPES] Update Type Definitions.** (Completed: `ITokenWalletService` and `TokenWalletTransaction` reflect mandatory `recordedByUserId` and `paymentTransactionId`)
        *   [✅] Task `4.1.1.2` (Create Postgres function `record_token_transaction`) must be implemented, robust, and verified before the `recordTransaction` service method's TDD cycle can be successfully completed. (Function exists and basic interaction verified)
    *   **`createWallet` Method:**
        *   [✅] **4.1.1.1.1: [TEST-UNIT] Define Test Cases for `TokenWalletService.createWallet`**
            *   Successful user wallet creation (`userId` provided, `organizationId` is null).
            *   Successful organization wallet creation (`organizationId` provided, `userId` is null).
            *   Failure if neither `userId` nor `organizationId` is provided.
            *   Consider behavior if *both* `userId` and `organizationId` are provided (align with DB constraints: current `user_or_org_wallet` constraint allows this, but service might enforce mutual exclusivity or specific logic).
            *   Verify the returned `TokenWallet` object structure, default balance, currency, etc.
            *   Verify data persistence and correct field mapping in the `token_wallets` table.
        *   [✅] **4.1.1.1.2: [TEST-UNIT] Write Failing Integration Tests for `TokenWalletService.createWallet` (RED)** (Tests written, initial failures led to implementation)
        *   [✅] **4.1.1.1.3: [BE] Implement `TokenWalletService.createWallet` method.**
            *   Location: `supabase/functions/_shared/services/tokenWalletService.ts`.
            *   Handle insertion into `token_wallets` table.
            *   Return the created `TokenWallet` object.
        *   [✅] **4.1.1.1.4: [TEST-UNIT] Run `createWallet` Tests until GREEN.** (Tests are now passing)
        *   [✅] **4.1.1.1.5: [REFACTOR] Refactor `createWallet` Implementation and Associated Tests.** (Iterative improvements made for robustness, including admin client usage, dummy org handling, and assertion corrections).
        *   [ ] **4.1.1.1.6: [COMMIT]** "feat(BE|TEST): Implement and test TokenWalletService.createWallet"
    *   **`recordTransaction` Method:** (Depends on `createWallet` for test setup, and the finalized PG function from `4.1.1.2` & `4.1.1.1a` requirements)
        *   [ ] **4.1.1.1.7: [TEST-UNIT] Define Test Cases for `TokenWalletService.recordTransaction`**
            *   Successful `CREDIT_PURCHASE` transaction.
            *   Successful `DEBIT_USAGE` transaction. (Test case defined, not yet implemented/run)
            *   Failure scenario: Target wallet ID does not exist. (Test case defined and passing)
            *   Failure scenario: `recordedByUserId` is missing (as it's now mandatory). (Test case defined, not yet implemented/run)
            *   Verify the structure and content of the returned `TokenWalletTransaction` object.
            *   Verify correct data persistence in `token_wallet_transactions` table.
            *   Verify that `token_wallets.balance` is correctly updated by the underlying `record_token_transaction` PG function.
        *   [✅] **4.1.1.1.8: [TEST-UNIT] Write Failing Integration Tests for `TokenWalletService.recordTransaction` (RED)** (Tests for successful credit and non-existent wallet written; initial failures led to implementation refinements)
        *   [✅] **4.1.1.1.9: [BE] Verify/Refine `TokenWalletService.recordTransaction` method implementation.** (Method refined to handle RPC array return, snake_case to camelCase mapping, type conversions, and inclusion of `paymentTransactionId`).
        *   [✅] **4.1.1.1.10: [TEST-UNIT] Run `recordTransaction` Tests until GREEN.** (Tests for successful credit and non-existent wallet are now passing).
        *   [✅] **4.1.1.1.11: [REFACTOR] Refactor `recordTransaction` Implementation and Tests.** (Iterative improvements to RPC data handling and type mapping).
        *   [ ] **4.1.1.1.12: [COMMIT]** "feat(BE|TEST): Implement and test TokenWalletService.recordTransaction (credit, non-existent wallet)"
    *   **`getWallet` Method:**
        *   [ ] **4.1.1.1.13: [TEST-UNIT] Define Test Cases & Write Failing Integration Tests for `TokenWalletService.getWallet` (RED)**
        *   [ ] **4.1.1.1.14: [BE] Implement `TokenWalletService.getWallet` method.**
        *   [ ] **4.1.1.1.15: [TEST-UNIT] Run `getWallet` Tests until GREEN.**
        *   [ ] **4.1.1.1.16: [REFACTOR] Refactor `getWallet` Implementation and Tests.**
        *   [ ] **4.1.1.1.17: [COMMIT]** "feat(BE|TEST): Implement and test TokenWalletService.getWallet"
    *   **`getWalletForContext` Method:**
        *   [ ] **4.1.1.1.18: [TEST-UNIT] Define Test Cases & Write Failing Integration Tests for `TokenWalletService.getWalletForContext` (RED)**
        *   [ ] **4.1.1.1.19: [BE] Implement `TokenWalletService.getWalletForContext` method.**
        *   [ ] **4.1.1.1.20: [TEST-UNIT] Run `getWalletForContext` Tests until GREEN.**
        *   [ ] **4.1.1.1.21: [REFACTOR] Refactor `getWalletForContext` Implementation and Tests.**
        *   [ ] **4.1.1.1.22: [COMMIT]** "feat(BE|TEST): Implement and test TokenWalletService.getWalletForContext"
    *   **`getBalance` Method:**
        *   [ ] **4.1.1.1.23: [TEST-UNIT] Define Test Cases & Write Failing Integration Tests for `TokenWalletService.getBalance` (RED)**
        *   [ ] **4.1.1.1.24: [BE] Implement `TokenWalletService.getBalance` method.**
        *   [ ] **4.1.1.1.25: [TEST-UNIT] Run `getBalance` Tests until GREEN.**
        *   [ ] **4.1.1.1.26: [REFACTOR] Refactor `getBalance` Implementation and Tests.**
        *   [ ] **4.1.1.1.27: [COMMIT]** "feat(BE|TEST): Implement and test TokenWalletService.getBalance"
    *   **`checkBalance` Method:**
        *   [ ] **4.1.1.1.28: [TEST-UNIT] Define Test Cases & Write Failing Integration Tests for `TokenWalletService.checkBalance` (RED)**
        *   [ ] **4.1.1.1.29: [BE] Implement `TokenWalletService.checkBalance` method.**
        *   [ ] **4.1.1.1.30: [TEST-UNIT] Run `checkBalance` Tests until GREEN.**
        *   [ ] **4.1.1.1.31: [REFACTOR] Refactor `checkBalance` Implementation and Tests.**
        *   [ ] **4.1.1.1.32: [COMMIT]** "feat(BE|TEST): Implement and test TokenWalletService.checkBalance"
    *   **`getTransactionHistory` Method:**
        *   [ ] **4.1.1.1.33: [TEST-UNIT] Define Test Cases & Write Failing Integration Tests for `TokenWalletService.getTransactionHistory` (RED)**
        *   [ ] **4.1.1.1.34: [BE] Implement `TokenWalletService.getTransactionHistory` method.**
        *   [ ] **4.1.1.1.35: [TEST-UNIT] Run `getTransactionHistory` Tests until GREEN.**
        *   [ ] **4.1.1.1.36: [REFACTOR] Refactor `getTransactionHistory` Implementation and Tests.**
        *   [ ] **4.1.1.1.37: [COMMIT]** "feat(BE|TEST): Implement and test TokenWalletService.getTransactionHistory"
*   [ ] **4.1.1.1a: [ARCH] [DB] [TYPES] Enhance `recorded_by_user_id` for Full Auditability**
    *   **Goal:** Ensure every transaction is auditable to a specific user, system process, or admin action.
    *   [🚧] **4.1.1.1a.1: [DB] Make `recorded_by_user_id` mandatory.** (Moved to prerequisites above)
        *   Modify `record_token_transaction` SQL function: `p_recorded_by_user_id UUID` (not nullable). (Covered by 4.1.1.2)
        *   Modify `token_wallet_transactions` table: `recorded_by_user_id UUID NOT NULL`. (This needs to be done via a migration)
    *   [ ] **4.1.1.1a.2: [TYPES] Update Type Definitions.** (Moved to prerequisites above)
        *   Modify `ITokenWalletService` (`recordTransaction` params) to require `recordedByUserId: string`.
        *   Modify `TokenWalletTransaction` type to make `recordedByUserId: string` (non-nullable).
    *   [ ] **4.1.1.1a.3: [BE] [ARCH] Define Strategy for System-Initiated Recorder IDs.**
        *   For actions not tied to a direct end-user (e.g., subscription renewals, admin adjustments), use designated placeholder UUIDs initially.
        *   Examples: `00000000-SYSTEM-SUB-0001` for subscriptions, `00000000-SYSTEM-ADM-0001` for admin actions. (These should be valid UUIDs in practice).
        *   Document these placeholder IDs and their intended future replacements.
    *   [ ] **4.1.1.1a.4: [PLAN] Schedule Future Work: Implement Traceable System/Admin IDs.**
        *   Add tasks to later phases (e.g., Admin Panel Implementation, Subscription Management) to replace placeholder `recorded_by_user_id` values with actual `subscription_id`s (linked to `payment_transactions` or a new `subscriptions` table) or `admin_user_id`s from an admin authentication system. This ensures long-term, granular auditability of all system-generated transactions.
*   [🚧] **4.1.1.2: [DB] Create Postgres function `record_token_transaction`**
    *   This function takes transaction parameters (including a mandatory `p_recorded_by_user_id`), updates `token_wallets.balance`, inserts into `token_wallet_transactions` (with `recorded_by_user_id NOT NULL`), and returns the new transaction record. It MUST run within a transaction and implement robust idempotency. (This is a key prerequisite for the `recordTransaction` service method TDD cycle)
*   [ ] **4.1.1.3: [COMMIT]** "feat(BE|DB): Implement core TokenWalletService and atomic DB transaction function with tests"

*   [🚧] **4.1.1.4: [BE] [RLS] Secure Tokenomics Tables**
    *   **Goal:** Implement Row-Level Security for `token_wallets`, `token_wallet_transactions`, and `payment_transactions` to ensure data integrity and proper access control.
    *   [🚧] **4.1.1.4.1: [RLS] Define and Apply RLS for `token_wallets`**
        *   `SELECT`: Users can select their own wallet(s) (`user_id = auth.uid()`) or wallets of organizations they are a member of (requires join with `organization_members`). Service role for full access.
        *   `INSERT`: Restrict to `service_role` or specific trusted roles/functions. End-users should not directly insert wallets.
        *   `UPDATE`: Generally restrict direct updates, especially to `balance`. Updates to `balance` should occur via the `record_token_transaction` function. Other fields (e.g., metadata if added) might have more permissive policies for owners.
        *   `DELETE`: Restrict to `service_role` or specific admin-only functions.
    *   [🚧] **4.1.1.4.2: [RLS] Define and Apply RLS for `token_wallet_transactions`**
        *   `SELECT`: Users can select transactions belonging to their own wallet(s) or wallets of organizations they are a member of (join `token_wallets` then check ownership/membership).
        *   `INSERT`: Restrict to `service_role` or the `record_token_transaction` function (which is `SECURITY DEFINER`). End-users should not directly insert ledger entries.
        *   `UPDATE`: Forbid all updates (`USING (false)` and `WITH CHECK (false)`). Ledger entries should be immutable.
        *   `DELETE`: Forbid all deletes. Ledger entries should be immutable.
    *   [🚧] **4.1.1.4.3: [RLS] Define and Apply RLS for `payment_transactions`**
        *   `SELECT`: Users can select their own payment transactions (`user_id = auth.uid()`) or payments related to organizations they manage.
        *   `INSERT`: Primarily by backend services when initiating payments. Authenticated users might trigger this via an edge function that runs with elevated privileges for the insert.
        *   `UPDATE`: Status updates (e.g., 'pending' to 'completed') should be handled by trusted backend processes (like webhook handlers or payment confirmation services), not directly by users.
        *   `DELETE`: Generally restrict or disallow. Refunds should be new transactions or status updates.
    *   [ ] **4.1.1.4.4: [TEST-INT] Write RLS tests.** Verify that users can/cannot access/modify data according to policies.
    *   [ ] **4.1.1.4.5: [COMMIT]** "feat(RLS): Implement row-level security for tokenomics tables"

### 4.1.2: [BE] Implement Stripe Payment Gateway Adapter
*   [ ] **4.1.2.1: [BE] [TEST-UNIT] Create `supabase/functions/_shared/adapters/stripePaymentAdapter.ts`**
    *   Implement `IPaymentGatewayAdapter` for Stripe (using Stripe SDK).
    *   `initiatePayment`: Create Stripe Checkout Session or Payment Intent. Create a `payment_transactions` record in 'PENDING' state, store its ID in Stripe metadata.
    *   `handleWebhook`: Process Stripe webhooks (e.g., `checkout.session.completed`, `payment_intent.succeeded`).
        *   Verify webhook signature.
        *   Retrieve `payment_transactions.id` from Stripe metadata.
        *   Update `payment_transactions` record to 'COMPLETED' and store `gateway_transaction_id`.
        *   Call `TokenWalletService.recordTransaction` to credit the user's wallet with `tokens_to_award` from the `payment_transactions` record.
    *   Write unit tests (mocking Stripe SDK, Supabase client, and `TokenWalletService`).
*   [ ] **4.1.2.2: [COMMIT]** "feat(BE): Implement StripePaymentAdapter with tests"

### 4.1.3: [BE] Payment Initiation & Webhook Endpoints
*   [ ] **4.1.3.1: [BE] Create Edge Function `POST /initiate-payment`**
    *   `supabase/functions/initiate-payment/index.ts`:
        *   Authenticates user, identifies `target_wallet_id`.
        *   Takes `PurchaseRequest` (e.g., `itemId`, `paymentGatewayId`).
        *   (Service layer?) Determines `tokens_to_award`, `amount_fiat/crypto` based on `itemId`.
        *   Dynamically selects adapter based on `paymentGatewayId` from `PurchaseRequest`.
        *   Calls `adapter.initiatePayment`.
        *   Returns `PaymentInitiationResult`.
    *   [TEST-INT] Write integration tests.
*   [ ] **4.1.3.2: [BE] Create Edge Function `POST /webhooks/stripe`**
    *   `supabase/functions/webhooks-stripe/index.ts`:
        *   Securely verifies and processes Stripe webhook.
        *   Instantiates `StripePaymentAdapter`.
        *   Calls `adapter.handleWebhook`.
    *   [TEST-INT] Write integration tests (may require Stripe CLI for local testing).
*   [ ] **4.1.3.3: [COMMIT]** "feat(BE): Add endpoints for payment initiation and Stripe webhooks"

### 4.1.4: [BE] Placeholder for Coinbase/Crypto Payment Gateway Adapter
*   [ ] **4.1.4.1: [BE] Create `supabase/functions/_shared/adapters/coinbasePaymentAdapter.ts` (Skeleton)**
    *   Define the class implementing `IPaymentGatewayAdapter` with methods throwing `NotImplementedError`.
*   [ ] **4.1.4.2: [COMMIT]** "feat(BE): Add skeleton for CoinbasePaymentAdapter"

---

## Phase 4.2: [BE] Token Consumption Logic

**Goal:** Adapt AI service usage to debit tokens from the new wallet system.

*   [ ] **4.2.1: [BE] Modify `chat` Edge Function for Wallet Debits**
    *   In `supabase/functions/chat/index.ts`:
        1.  Get `userId` and `organizationId` for context.
        2.  Instantiate `TokenWalletService`.
        3.  Call `tokenWalletService.getWalletForContext(userId, organizationId)` to get `walletId` and `currentBalance`.
        4.  Estimate `tokensRequiredForNextMessage` (using server-side `tiktoken` on user prompt, or a pre-defined cost).
        5.  If `currentBalance < tokensRequiredForNextMessage`, return 402 error "Insufficient token balance".
        6.  Proceed to call AI Provider.
        7.  On successful AI response, get `actualTokensConsumed` from provider's response (prompt + completion).
        8.  Call `tokenWalletService.recordTransaction({ walletId, type: 'DEBIT_USAGE', amount: actualTokensConsumed.toString(), relatedEntityId: newChatMessage.id, relatedEntityType: 'chat_message' })`.
        9.  If `recordTransaction` fails (e.g., rare concurrent update led to insufficient balance despite initial check), handle gracefully (log error, potentially don't show AI response or mark as failed). *This step requires careful thought on UX vs. strict accounting.*
    *   Still log `actualTokensConsumed` in `chat_messages.token_usage` for granular per-message data.
*   [ ] **4.2.2: [TEST-INT] Update `POST /chat` Integration Tests**
    *   Verify wallet balance checks before AI call.
    *   Verify wallet debits occur after successful AI call via `token_wallet_transactions` ledger.
    *   Verify error handling for insufficient funds.
*   [ ] **4.2.3: [COMMIT]** "feat(BE): Integrate AI chat with token wallet for debits"

---

## Phase 4.3: [API] [STORE] API Client & State Management for Wallets

**Goal:** Expose wallet functionalities through the API client and manage wallet state on the frontend.

*   [ ] **4.3.1: [API] Add Wallet Methods to API Client**
    *   `packages/api/src/clients/WalletApiClient.ts` (new):
        *   `getWalletInfo(organizationId?: string | null): Promise<ApiResponse<TokenWallet | null>>`
        *   `getWalletTransactionHistory(organizationId?: string | null, limit?: number, offset?: number): Promise<ApiResponse<TokenWalletTransaction[]>>`
        *   `initiateTokenPurchase(request: PurchaseRequest): Promise<ApiResponse<PaymentInitiationResult>>`
    *   [TEST-UNIT] Write unit tests for these new API client methods in `packages/api/src/tests/clients/WalletApiClient.test.ts`.
*   [ ] **4.3.2: [BE] Create Backend Endpoints for Wallet Info & History**
    *   `GET /wallet-info`: Uses `TokenWalletService.getWalletForContext`.
    *   `GET /wallet-history`: Uses `TokenWalletService.getTransactionHistory`.
    *   [TEST-INT] Write integration tests for these new endpoints (`supabase/functions/wallet-info/index.ts`, `supabase/functions/wallet-history/index.ts`).
*   [ ] **4.3.3: [STORE] Create `useWalletStore`**
    *   `packages/store/src/walletStore.ts`:
        *   State: `currentWallet: TokenWallet | null`, `transactionHistory: TokenWalletTransaction[]`, `isLoadingWallet: boolean`, `isLoadingHistory: boolean`, `isLoadingPurchase: boolean`, `walletError: Error | null`, `purchaseError: Error | null`.
        *   Actions: `loadWallet(organizationId?: string | null)`, `loadTransactionHistory(organizationId?: string | null, ...paging)`, `initiatePurchase(request: PurchaseRequest): Promise<PaymentInitiationResult | null>`.
        *   Selectors: `selectCurrentWalletBalance` (returns `currentWallet.balance` or '0'), `selectWalletTransactions`.
    *   [TEST-UNIT] Write unit tests in `packages/store/src/tests/walletStore.test.ts`.
*   [ ] **4.3.4: [COMMIT]** "feat(API|STORE|BE): Expose wallet info/history via API and manage in useWalletStore"

---

## Phase 4.4: [UI] Frontend - Wallet & Token Consumption UI

**Goal:** Implement UI for users to view their token wallet, acquire tokens, and see usage. The "budget audit" concept shifts to "wallet balance check".

### 4.4.1: [UI] Token Estimator Hook (`useTokenEstimator`)
*   [ ] **4.4.1.1: [UI] [TEST-UNIT] Define Test Cases for `useTokenEstimator` Hook**
    *   In `apps/web/src/hooks/useTokenEstimator.unit.test.ts`. Mock `tiktoken`. Test samples, empty string.
*   [ ] **4.4.1.2: [UI] Create hook `apps/web/src/hooks/useTokenEstimator.ts`**
    *   `import { getEncoding } from 'tiktoken'; const encoding = getEncoding('cl100k_base'); export const useTokenEstimator = (text: string) => React.useMemo(() => text ? encoding.encode(text).length : 0, [text]);`
*   [ ] **4.4.1.3: [UI] [TEST-UNIT] Write tests for the hook. Expect failure (RED).**
*   [ ] **4.4.1.4: [UI] Implement the hook. Run tests until pass (GREEN).**
*   [ ] **4.4.1.5: [UI] Integrate Hook into Chat Input Component (`AiChatbox.tsx` or `ChatInput.tsx`)**
    *   Use the `useTokenEstimator` hook with the current text input value.
    *   Display the estimated count near the input field (e.g., "Tokens for this message: ~{count}").
*   [ ] **4.4.1.6: [UI] [TEST-UNIT] Write/Update component tests for chat input to verify display.**
*   [ ] **4.4.1.7: [COMMIT]** "feat(UI): Implement token estimator hook and display in chat input w/ tests"

### 4.4.2: [UI] Per-Message Token Usage Display (`ChatMessageBubble.tsx`)
*   [ ] **4.4.2.1: [UI] [TEST-UNIT] Define Test Cases for `ChatMessageBubble.tsx`**
    *   Verify token count (e.g., "P:{prompt}/C:{completion}") displays only for assistant messages with `message.token_usage` data.
*   [ ] **4.4.2.2: [UI] [TEST-UNIT] Write/Update tests for `apps/web/src/components/ai/ChatMessageBubble.tsx`.**
*   [ ] **4.4.2.3: [UI] Update `ChatMessageBubble.tsx`**
  *   If `message.role === 'assistant'` and `message.token_usage` (e.g., `message.token_usage.completionTokens`, `message.token_usage.promptTokens`), display the count. Style subtly.
*   [ ] **4.4.2.4: [UI] [TEST-UNIT] Run tests. Debug until pass (GREEN).**
*   [ ] **4.4.2.5: [COMMIT]** "feat(UI): Add token usage display to assistant chat messages w/ tests"

### 4.4.3: [UI] Cumulative Session Token Usage Display (`ChatTokenUsageDisplay.tsx`)
*   [ ] **4.4.3.1: [STORE] Enhance `useAiStore` for Cumulative Session Tokens** (If not already fully covered by 4.2.3 from the previous plan)
    *   `packages/store/src/aiStore.ts`:
        *   Selector: `selectCurrentChatSessionTokenUsage: () => { userTokens: number, assistantTokens: number, totalTokens: number }`
            *   Calculates sum from `currentChatMessages`' `token_usage` fields.
    *   [TEST-UNIT] Write/verify tests in `aiStore.selectors.test.ts`.
*   [ ] **4.4.3.2: [UI] [TEST-UNIT] Define Test Cases for `ChatTokenUsageDisplay.tsx`**
    *   In `apps/web/src/components/ai/ChatTokenUsageDisplay.unit.test.tsx`.
    *   Mocks `useAiStore` with `selectCurrentChatSessionTokenUsage`.
    *   Verifies correct display of User/Assistant/Total tokens for the *current session*.
*   [ ] **4.4.3.3: [UI] [TEST-UNIT] Write tests. Expect RED.**
*   [ ] **4.4.3.4: [UI] Create component `apps/web/src/components/ai/ChatTokenUsageDisplay.tsx`**
  *   Uses `useAiStore(selectCurrentChatSessionTokenUsage)`.
  *   Displays: `Session Usage - User: {userTokens}, AI: {assistantTokens}, Total: {totalTokens}`.
*   [ ] **4.4.3.5: [UI] [TEST-UNIT] Run component tests. Debug until pass (GREEN).**
*   [ ] **4.4.3.6: [REFACTOR]** Optimize calculation if needed. Ensure clear display.
*   [ ] **4.4.3.7: [COMMIT]** "feat(UI|STORE): Create cumulative session token usage display component & selector w/ tests"

### 4.4.4: [UI] Integrate Token UI into Main Chat Page (`AiChatPage.tsx`)
*   [ ] **4.4.4.1: [UI] Update `apps/web/src/pages/AiChatPage.tsx`**
  *   Ensure token estimator is displayed near input (covered by 4.4.1.5).
  *   Integrate `ChatTokenUsageDisplay` component. Place appropriately.
  *   Trigger `token_usage_displayed` analytics event when `ChatTokenUsageDisplay` is visible and has data.
*   [ ] **4.4.4.2: [TEST-INT] Perform manual integration tests.** Send messages, verify estimator updates. Verify assistant messages show tokens. Verify cumulative display updates. Verify analytics.
*   [ ] **4.4.4.3: [COMMIT]** "feat(UI): Integrate token tracking UI components into chat page w/ manual tests & analytics"

### 4.4.5: [UI] Wallet Balance Check Hook (`useAIChatAffordabilityStatus`) & Chat Input Integration
*   [ ] **4.4.5.1: [UI] [TEST-UNIT] Define Test Cases for `useAIChatAffordabilityStatus` Hook**
    *   In `apps/web/src/hooks/useAIChatAffordabilityStatus.unit.test.ts`.
    *   Mocks `useWalletStore` (for `selectCurrentWalletBalance`).
    *   Mocks `useTokenEstimator` (or takes estimated cost as prop).
    *   Test various balance/cost scenarios.
    *   Verify correct status: `{ currentBalance: string, estimatedNextCost: number, canAffordNext: boolean, lowBalanceWarning: boolean }`.
*   [ ] **4.4.5.2: [UI] Create `apps/web/src/hooks/useAIChatAffordabilityStatus.ts` Hook**
    *   Takes `estimatedNextCost: number` as input.
    *   Gets `currentBalance` from `useWalletStore(selectCurrentWalletBalance)`.
    *   Compares. `lowBalanceWarning` if `currentBalance < estimatedNextCost * 3` (configurable threshold).
*   [ ] **4.4.5.3: [UI] [TEST-UNIT] Write tests for the hook. Debug until (GREEN).**
*   [ ] **4.4.5.4: [UI] Integrate Hook into Chat Input (`AiChatbox.tsx` or `ChatInput.tsx`)**
    *   Use `estimatedTokens = useTokenEstimator(currentInputValue)`.
    *   Use `const { canAffordNext, lowBalanceWarning } = useAIChatAffordabilityStatus(estimatedTokens);`.
    *   If `lowBalanceWarning`, display a message (e.g., "Token balance is low").
    *   If `!canAffordNext`, disable send button and show message (e.g., "Insufficient balance for this message").
*   [ ] **4.4.5.5: [UI] [TEST-UNIT] Update Chat Input component tests for these conditional UI changes.**
*   [ ] **4.4.5.6: [COMMIT]** "feat(UI): Implement AI chat affordability hook and integrate into chat input w/ tests"

### 4.4.6: [UI] Wallet Balance Display, Top-Up, and History Pages
*   [ ] **4.4.6.1: [UI] Wallet Balance Display Component (`WalletBalanceDisplay.tsx`)**
    *   Create `apps/web/src/components/wallet/WalletBalanceDisplay.tsx`.
    *   Uses `useWalletStore(selectCurrentWalletBalance)` and `state.isLoadingWallet`.
    *   Displays balance or loading/error.
    *   [TEST-UNIT] Write tests.
    *   Integrate into `UserAccountPage.tsx` and relevant Org views. On mount, call `useWalletStore.getState().loadWallet()`.
*   [ ] **4.4.6.2: [UI] Token Acquisition/Top-Up UI (`TopUpPage.tsx` or Modal)**
    *   Create `apps/web/src/pages/TopUpPage.tsx`.
    *   User selects token package (defined statically or fetched).
    *   User selects payment method (Stripe initially).
    *   Calls `useWalletStore.getState().initiatePurchase({ itemId, paymentGatewayId: 'stripe', ... })`.
    *   Handles `PaymentInitiationResult` (e.g., redirect to Stripe or use Stripe Elements).
    *   [TEST-UNIT] Write tests (mocking store action).
*   [ ] **4.4.6.3: [UI] Wallet Transaction History UI (`WalletHistoryPage.tsx`)**
    *   Create `apps/web/src/pages/WalletHistoryPage.tsx`.
    *   Uses `useWalletStore(selectWalletTransactions)` and `state.isLoadingHistory`.
    *   Calls `useWalletStore.getState().loadTransactionHistory()` on mount. Supports pagination.
    *   [TEST-UNIT] Write tests.
*   [ ] **4.4.6.4: [COMMIT]** "feat(UI): Implement wallet balance display, top-up page, and transaction history page w/ tests"

---

## Phase 4.5: [ARCH] Tauri/Rust Desktop Wallet Integration Strategy (High-Level Design)

**Goal:** Outline how the web platform's token wallet could potentially interact or synchronize with the Tauri/Rust desktop crypto wallet. This is a research and design phase.

*   [ ] **4.5.1: [ARCH] Define Synchronization Model & Use Cases**
    *   **Use Case 1 (Desktop as Payment Method):** User wants to use crypto from their Tauri wallet to buy AI Tokens for the web platform.
        *   Model: Tauri app communicates with a custom "TauriPaymentAdapter" on the backend.
    *   **Use Case 2 (Desktop as Client to AI Platform Wallet):** Desktop app wants to show AI Token balance and allow use of AI services, debiting the same centralized AI Token wallet.
        *   Model: Tauri app's backend calls the same APIs as the web app (`/wallet-info`, `/chat` with token debits).
    *   **Initial Focus:** Use Case 1. The Tauri wallet helps *acquire* platform AI Tokens.
*   [ ] **4.5.2: [ARCH] `TauriPaymentAdapter` Design (for Use Case 1)**
    *   The web UI's "Top-Up" page could have "Pay with Tauri Wallet" option.
    *   Clicking this triggers `initiatePurchase` with `paymentGatewayId: 'tauri_crypto_wallet'`.
    *   Backend `TauriPaymentAdapter.initiatePayment` might:
        *   Generate a unique transaction ID for the platform.
        *   Return instructions/deep-link for the user to open their Tauri wallet and approve a specific crypto transfer to a designated platform address, including the transaction ID in memo/metadata.
    *   A separate backend process/webhook listener for the platform's crypto deposit address would:
        *   Detect incoming crypto transactions.
        *   Match the memo/metadata to a pending `payment_transactions` record.
        *   Call `TokenWalletService.recordTransaction` to credit AI Tokens.
*   [ ] **4.5.3: [ARCH] Security & UX for Tauri Payment Flow.**
*   [ ] **4.5.4: [DOC] Document the chosen integration strategy for Tauri payments.**
*   [ ] **4.5.5: [COMMIT]** "docs(ARCH): Outline strategy for Tauri desktop wallet as a payment method for AI Tokens"
    *   *(Actual implementation of this adapter and flow would be a subsequent phase)*

---

## Phase 4.6: End-to-End Testing, Refinement, and Security Review

**Goal:** Ensure the entire advanced tokenomics system is robust, secure, and functions correctly.

*   [ ] **4.6.1: [TEST-INT] Comprehensive E2E Testing**
    *   Test full lifecycle: User sign-up -> No AI tokens -> Top-up via Stripe -> Wallet balance updates -> Use AI services (verify debits) -> View transaction history.
    *   Test with organization wallets if applicable.
    *   Test insufficient funds scenarios during AI usage and top-up.
    *   Test Stripe webhook processing reliability and idempotency (e.g., if webhook is sent twice).
    *   Test error handling and UI feedback for payment failures.
*   [ ] **4.6.2: [REFACTOR] Code Review and Refinement**
    *   Review all new services, adapters, stores, and UI components.
    *   Focus on atomicity of ledger transactions (DB functions/service layer transactions), error handling in payment flows, and clarity of abstractions (interfaces, adapters).
*   [ ] **4.6.3: [SECURITY] Security Review**
    *   Payment initiation: CSRF protection, input validation.
    *   Webhook verification: Strict signature checking, protection against replay.
    *   RLS policies for all new tables (`token_wallets`, `token_wallet_transactions`, `payment_transactions`).
    *   Authorization for all new backend endpoints.
    *   Prevention of unauthorized balance modifications.
*   [ ] **4.6.4: [COMMIT]** "refactor: Final refinements and hardening for advanced tokenomics system"

---
