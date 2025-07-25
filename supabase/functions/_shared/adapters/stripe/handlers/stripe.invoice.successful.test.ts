import { StripePaymentAdapter } from '../stripePaymentAdapter.ts';
import type { TokenWalletTransaction, TokenWalletTransactionType } from '../../../types/tokenWallet.types.ts';
import { MockTokenWalletService } from '../../../services/tokenWalletService.mock.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js';
import Stripe from 'npm:stripe';
import type { PurchaseRequest, PaymentOrchestrationContext } from '../../../types/payment.types.ts';
import {
  assert,
  assertEquals,
  assertRejects,
  assertExists,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  assertSpyCalls,
  spy,
  stub,
  type SpyCall,
  type Spy
} from 'jsr:@std/testing@0.225.1/mock';
import { createMockStripe, MockStripe } from '../../../stripe.mock.ts';
import { createMockSupabaseClient, MockSupabaseClientSetup, MockSupabaseDataConfig, MockQueryBuilderState } from '../../../supabase.mock.ts';
import { createMockTokenWalletService } from '../../../services/tokenWalletService.mock.ts';
import { Database } from '../../../../types_db.ts';
import { ILogger, LogMetadata } from '../../../types.ts';
import { handleInvoicePaymentSucceeded } from './stripe.invoicePaymentSucceeded.ts';
import { HandlerContext } from '../../../stripe.mock.ts';

Deno.test('StripePaymentAdapter: initiatePayment', async (t) => {
  
  let mockStripe: MockStripe;
  let mockSupabaseSetup: MockSupabaseClientSetup;
  let mockTokenWalletService: MockTokenWalletService;
  let adapter: StripePaymentAdapter;

  const MOCK_SITE_URL = 'http://localhost:3000';
  const MOCK_WEBHOOK_SECRET = 'whsec_test_dummy';

  const setupMocksAndAdapter = (supabaseConfig: MockSupabaseDataConfig = {}) => {
    Deno.env.set('SITE_URL', MOCK_SITE_URL);
    mockStripe = createMockStripe();
    // Corrected: Pass undefined for currentTestUserId and supabaseConfig as the second argument
    mockSupabaseSetup = createMockSupabaseClient(undefined, supabaseConfig);
    mockTokenWalletService = createMockTokenWalletService();

    adapter = new StripePaymentAdapter(
      mockStripe.instance,
      mockSupabaseSetup.client as unknown as SupabaseClient,
      mockTokenWalletService.instance,
      MOCK_WEBHOOK_SECRET
    );
  };

  const teardownMocks = () => {
    Deno.env.delete('SITE_URL');
    if (mockStripe && typeof mockStripe.clearStubs === 'function') {
        mockStripe.clearStubs();
    }
    if (mockTokenWalletService && typeof mockTokenWalletService.clearStubs === 'function') {
        mockTokenWalletService.clearStubs();
    }
  };

  await t.step('initiatePayment - happy path: one-time purchase successfully initiates payment', async () => {
    const basePurchaseRequest: PurchaseRequest = {
      userId: 'user-happy-path-otp',
      itemId: 'item-otp-standard-plan',
      quantity: 1,
      currency: 'USD',
      paymentGatewayId: 'stripe',
      metadata: { test_run: 'happy-otp'}
    };

    const context: PaymentOrchestrationContext = {
      ...basePurchaseRequest,
      internalPaymentId: 'ptxn_happy_otp_123',
      targetWalletId: 'wallet_user_happy_otp',
      tokensToAward: 1000,
      amountForGateway: 10.00, // Assuming item-otp-standard-plan costs 10.00 for quantity 1
      currencyForGateway: 'USD',
    };

    const planData = { 
      stripe_price_id: context.itemId, // Ensure this matches context.itemId for the mock
      item_id_internal: 'internal_otp_standard_id', // Add a distinct internal ID if needed
      plan_type: 'one_time_purchase', 
    };

    const stripeSessionData = { 
      id: 'cs_test_happy_otp_456', 
      url: 'https://stripe.com/pay/happy_otp', 
      payment_intent: 'pi_happy_otp_123', // Added for client_secret extraction simulation
      // client_secret should be part of the payment_intent object if it's expanded
      object: 'checkout.session',
      status: 'open',
      livemode: false,
      lastResponse: {
        headers: {},
        requestId: 'req_test_happy_otp',
        statusCode: 200,
        apiVersion: undefined,
        idempotencyKey: undefined,
        stripeAccount: undefined,
      }
    } as Stripe.Response<Stripe.Checkout.Session>; // Cast for type safety

    // Mock for payment_intent retrieval for client_secret - Temporarily commented out pending stripe.mock.ts update
    /*
    const mockPaymentIntent = {
      id: 'pi_happy_otp_123',
      client_secret: 'pi_happy_otp_123_secret_test'
      // ... other necessary PI fields
    } as Stripe.PaymentIntent;
    */

    const supabaseConfig: MockSupabaseDataConfig = {
      genericMockResults: {
        'subscription_plans': {
          select: async (state: MockQueryBuilderState) => {
            // The adapter queries by 'stripe_price_id' using context.itemId as the value
            if (state.filters.some(f => f.column === 'stripe_price_id' && f.value === context.itemId)) {
              return { data: [planData], error: null, count: 1, status: 200, statusText: 'OK' };
            }
            const mockError = new Error(`Mock: Plan not found for stripe_price_id ${context.itemId}`);
            return { data: [], error: mockError, count: 0, status: 404, statusText: 'Not Found' };
          }
        },
        // No 'payment_transactions' mock needed here for initiatePayment adapter unit test
      }
    };
    
    setupMocksAndAdapter(supabaseConfig);

    // mockTokenWalletService.getWalletForContext is not called by adapter
    // So, no need to stub it here for this particular test path.

    if (mockStripe.stubs.checkoutSessionsCreate?.restore) mockStripe.stubs.checkoutSessionsCreate.restore();
    mockStripe.stubs.checkoutSessionsCreate = stub(mockStripe.instance.checkout.sessions, "create", () => Promise.resolve(stripeSessionData));
    
    // Add stub for payment_intent retrieval for client_secret
    const mockPaymentIntentData = {
      id: stripeSessionData.payment_intent as string, 
      client_secret: `${stripeSessionData.payment_intent}_secret_test`
      // Add other PaymentIntent fields if needed by the adapter logic being tested, though client_secret is primary here
    };
    const mockPaymentIntentResponse = {
      ...mockPaymentIntentData,
      lastResponse: { headers: {}, requestId: 'req_test_otp', statusCode: 200 }
    } as Stripe.Response<Stripe.PaymentIntent>; // This is the full response object

    if (mockStripe.stubs.paymentIntentsRetrieve?.restore) mockStripe.stubs.paymentIntentsRetrieve.restore();
    mockStripe.stubs.paymentIntentsRetrieve = stub(mockStripe.instance.paymentIntents, "retrieve", 
      () => Promise.resolve(mockPaymentIntentResponse)
    );

    const result = await adapter.initiatePayment(context);

    assert(result.success, `Payment initiation should be successful. Error: ${result.error}`);
    assertEquals(result.transactionId, context.internalPaymentId, 'Incorrect transactionId');
    assertEquals(result.paymentGatewayTransactionId, stripeSessionData.id, 'Incorrect paymentGatewayTransactionId');
    assertEquals(result.redirectUrl, stripeSessionData.url ?? undefined, 'Incorrect redirectUrl');
    assertEquals(result.clientSecret, mockPaymentIntentData.client_secret, 'Incorrect clientSecret');
    
    // Verify that stripe.checkout.sessions.create was called with the correct mode
    const createCallArgs = mockStripe.stubs.checkoutSessionsCreate.calls[0]?.args[0] as Stripe.Checkout.SessionCreateParams;
    assert(createCallArgs, "Stripe session create was not called or args not captured");
    assertEquals(createCallArgs.mode, 'payment', "Stripe session mode should be 'payment' for one_time_purchase");
    assertEquals(createCallArgs.line_items?.[0].price, planData.stripe_price_id, "Stripe session price_id is incorrect");
    assertEquals(createCallArgs.line_items?.[0].quantity, context.quantity, "Stripe session quantity is incorrect");
    assertEquals(createCallArgs.metadata?.internal_payment_id, context.internalPaymentId, "Stripe metadata.internal_payment_id is incorrect");

    // mockTokenWalletService.getWalletForContext should not have been called by the adapter
    assertEquals(mockTokenWalletService.stubs.getWalletForContext.calls.length, 0, "getWalletForContext should not be called by adapter");
    assertEquals(mockTokenWalletService.stubs.createWallet.calls.length, 0, "createWallet should not be called by adapter");

    // Assert that subscription_plans was queried correctly
    assert(mockSupabaseSetup.spies.fromSpy.calls.some((call: SpyCall) => call.args[0] === 'subscription_plans'), "from('subscription_plans') should have been called.");
    
    const selectSpy = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'select');
    assertExists(selectSpy, "Select spy for subscription_plans should exist (OTP)");
    assertSpyCalls(selectSpy, 1);

    const eqSpy = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'eq');
    assertExists(eqSpy, "eq spy for subscription_plans should exist (OTP)");
    assertSpyCalls(eqSpy, 1);
    assertEquals(eqSpy.calls[0].args, ['stripe_price_id', context.itemId], "eq on subscription_plans called with wrong arguments (OTP)");

    const singleSpy = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'single');
    assertExists(singleSpy, "single spy for subscription_plans should exist (OTP)");
    assertSpyCalls(singleSpy, 1);

    teardownMocks();
  });

  await t.step('initiatePayment - error: item details (e.g., stripe_price_id) not found for itemId', async () => {
    const basePurchaseRequest: PurchaseRequest = {
      userId: 'user-no-item-details',
      itemId: 'item-non-existent',
      quantity: 1,
      currency: 'USD',
      paymentGatewayId: 'stripe',
    };
    const context: PaymentOrchestrationContext = {
        ...basePurchaseRequest,
        internalPaymentId: 'ptxn_no_item_789',
        targetWalletId: 'wallet_irrelevant_for_this_test',
        tokensToAward: 100,
        amountForGateway: 5.00,
        currencyForGateway: 'USD',
    };

    // Simulate subscription_plans returning no data for the itemId
    const supabaseConfig: MockSupabaseDataConfig = {
      genericMockResults: {
        'subscription_plans': {
          select: async (state: MockQueryBuilderState) => {
            if (state.filters.some(f => f.column === 'stripe_price_id' && f.value === context.itemId)) {
                // Simulate item not found
                return { data: [], error: { name: 'PostgrestError', message: 'Item not found', code: 'PGRST116' } as any, count: 0, status: 404, statusText: 'Not Found' };
            }
            const mockError = new Error('Mock: Unexpected item_id_internal query');
            return { data: [], error: mockError, count: 0, status: 500, statusText: 'Internal Server Error' };
          }
        }
      }
    };
    setupMocksAndAdapter(supabaseConfig);

    if (mockStripe.stubs.checkoutSessionsCreate?.restore) {
        mockStripe.stubs.checkoutSessionsCreate.restore();
    }
    mockStripe.stubs.checkoutSessionsCreate = stub(mockStripe.instance.checkout.sessions, "create", () => {
        throw new Error("Stripe checkout.sessions.create was called unexpectedly.");
    });

    // Define the expected error message from the mock
    const expectedErrorMessage = 'Item not found'; // This is the actual message from the mocked PostgrestError

    const result = await adapter.initiatePayment(context);

    assert(!result.success, "Payment initiation should fail when item details are not found.");
    // assertEquals(result.error, `Failed to retrieve valid plan details for item ID: ${context.itemId}. Reason: Item not found or missing key fields.`);
    assertEquals(result.error, expectedErrorMessage, "Error message should be 'Item not found' from the mock.");
    assertEquals(result.transactionId, context.internalPaymentId, "transactionId should still be present on failure.");
    assertEquals(result.paymentGatewayTransactionId, undefined, "paymentGatewayTransactionId should be undefined on failure.");
    assertEquals(result.redirectUrl, undefined, "redirectUrl should be undefined on failure.");
    assertEquals(result.clientSecret, undefined, "clientSecret should be undefined on failure.");

    assertSpyCalls(mockStripe.stubs.checkoutSessionsCreate, 0);
    assertEquals(mockTokenWalletService.stubs.createWallet.calls.length, 0);

    // Assert that subscription_plans was queried correctly even in failure case
    assert(mockSupabaseSetup.spies.fromSpy.calls.some((call: SpyCall) => call.args[0] === 'subscription_plans'), "from('subscription_plans') should have been called (item not found case).");

    const selectSpyNotFound = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'select');
    assertExists(selectSpyNotFound, "Select spy for subscription_plans should exist (item not found case)");
    assertSpyCalls(selectSpyNotFound, 1);

    const eqSpyNotFound = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'eq');
    assertExists(eqSpyNotFound, "eq spy for subscription_plans should exist (item not found case)");
    assertSpyCalls(eqSpyNotFound, 1);
    assertEquals(eqSpyNotFound.calls[0].args, ['stripe_price_id', context.itemId], "eq on subscription_plans called with wrong arguments (item not found case)");
    
    const singleSpyNotFound = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'single');
    assertExists(singleSpyNotFound, "single spy for subscription_plans should exist (item not found case)");
    assertSpyCalls(singleSpyNotFound, 1);

    teardownMocks();
  });

  await t.step('initiatePayment - error: Stripe checkout session creation fails', async () => {
    const basePurchaseRequest: PurchaseRequest = {
      userId: 'user-stripe-error',
      itemId: 'item-causes-stripe-error-final', // Unique item ID for clarity
      quantity: 1,
      currency: 'USD',
      paymentGatewayId: 'stripe',
    };
    const context: PaymentOrchestrationContext = {
        ...basePurchaseRequest,
        internalPaymentId: 'ptxn_stripe_checkout_final_fail_789',
        targetWalletId: 'wallet_irrelevant_for_this_stripe_error_final',
        tokensToAward: 300,
        amountForGateway: 25.00, // Example amount
        currencyForGateway: 'USD',
    };

    const planData = { 
        stripe_price_id: 'price_stripe_error_final', 
        plan_type: 'one_time_purchase',
    }; 
    const stripeError = new Error('Mock Stripe API error during session creation final test');

    const supabaseConfig: MockSupabaseDataConfig = {
      genericMockResults: {
        'subscription_plans': {
          select: async (state: MockQueryBuilderState) => {
            if (state.filters.some(f => f.column === 'stripe_price_id' && f.value === context.itemId)) {
                return { data: [planData], error: null, count: 1, status: 200, statusText: 'OK' };
            }
            return { data: [], error: new Error('Mock: Plan not found in Stripe error final test'), count: 0, status: 404, statusText: 'Not Found' };
          }
        },
      }
    };
    setupMocksAndAdapter(supabaseConfig);
    
    if (mockStripe.stubs.checkoutSessionsCreate?.restore) mockStripe.stubs.checkoutSessionsCreate.restore();
    mockStripe.stubs.checkoutSessionsCreate = stub(mockStripe.instance.checkout.sessions, "create", () => Promise.reject(stripeError));

    const result = await adapter.initiatePayment(context);

    assert(!result.success, 'Payment initiation should fail when Stripe API errors (final test)');
    assert(result.error?.includes(stripeError.message), 'Error message should indicate Stripe API error (final test)');
    
    assertEquals(mockStripe.stubs.checkoutSessionsCreate.calls.length, 1, "Stripe checkout session creation should have been attempted once (final test)");

    // Assert that subscription_plans was queried correctly before Stripe call
    assert(mockSupabaseSetup.spies.fromSpy.calls.some((call: SpyCall) => call.args[0] === 'subscription_plans'), "from('subscription_plans') should have been called (Stripe checkout fail case).");

    const selectSpyStripeFail = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'select');
    assertExists(selectSpyStripeFail, "Select spy for subscription_plans should exist (Stripe checkout fail case)");
    assertSpyCalls(selectSpyStripeFail, 1);

    const eqSpyStripeFail = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'eq');
    assertExists(eqSpyStripeFail, "eq spy for subscription_plans should exist (Stripe checkout fail case)");
    assertSpyCalls(eqSpyStripeFail, 1);
    assertEquals(eqSpyStripeFail.calls[0].args, ['stripe_price_id', context.itemId], "eq on subscription_plans called with wrong arguments (Stripe checkout fail case)");

    const singleSpyStripeFail = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'single');
    assertExists(singleSpyStripeFail, "single spy for subscription_plans should exist (Stripe checkout fail case)");
    assertSpyCalls(singleSpyStripeFail, 1);
    
    assertSpyCalls(mockStripe.stubs.checkoutSessionsCreate, 1); // Ensure Stripe's create was indeed called

    teardownMocks();
  });

  await t.step('initiatePayment - error: Stripe API call fails', async () => {
    const basePurchaseRequest: PurchaseRequest = {
      userId: 'user-stripe-api-error',
      itemId: 'item-causes-stripe-error',
      quantity: 1,
      currency: 'USD',
      paymentGatewayId: 'stripe',
    };
    const context: PaymentOrchestrationContext = {
        ...basePurchaseRequest,
        internalPaymentId: 'ptxn_stripe_fail_001',
        targetWalletId: 'wallet_irrelevant_for_this_error',
        tokensToAward: 500,
        amountForGateway: 20.00,
        currencyForGateway: 'USD',
    };

    const planData = { 
        stripe_price_id: 'price_causes_error', 
        plan_type: 'one_time_purchase', 
        // tokens_to_award and amount used by orchestrator
    };
    // const walletData = { walletId: 'wallet-for-user-stripe-error', balance: '0', currency: 'AI_TOKEN', createdAt: new Date(), updatedAt: new Date(), userId: basePurchaseRequest.userId } as TokenWallet;

    const supabaseConfig: MockSupabaseDataConfig = {
      genericMockResults: {
        'subscription_plans': {
          select: async (state: MockQueryBuilderState) => { 
            if (state.filters.some(f => f.column === 'stripe_price_id' && f.value === context.itemId)) {
                return { data: [planData], error: null, count: 1, status: 200, statusText: 'OK' };
            }
            const mockError = new Error('Mock: unexpected item_id in Stripe API error test');
            return { data: [], error: mockError, count: 0, status: 500, statusText: 'Server Error' };
          }
        }
      }
    };
    setupMocksAndAdapter(supabaseConfig);

    // mockTokenWalletService.getWalletForContext is not called by adapter
    // if (mockTokenWalletService.stubs.getWalletForContext?.restore) mockTokenWalletService.stubs.getWalletForContext.restore();
    // mockTokenWalletService.stubs.getWalletForContext = stub(mockTokenWalletService, "getWalletForContext", () => Promise.resolve(walletData)) as any;

    const stripeError = new Stripe.errors.StripeAPIError({ message: 'Simulated Stripe API Error', type: 'api_error' });
    if (mockStripe.stubs.checkoutSessionsCreate?.restore) mockStripe.stubs.checkoutSessionsCreate.restore();
    mockStripe.stubs.checkoutSessionsCreate = stub(mockStripe.instance.checkout.sessions, "create", () => Promise.reject(stripeError));

    const result = await adapter.initiatePayment(context); // Pass context

    assert(!result.success, 'Payment initiation should fail when Stripe API call fails');
    // assertEquals(result.error, 'Stripe API Error: Simulated Stripe API Error');
    assertEquals(result.error, stripeError.message, "Error message should match the rejected Stripe error message");
    
    assertEquals(mockStripe.stubs.checkoutSessionsCreate.calls.length, 1, "Stripe checkout.sessions.create should have been called once");

    // Check DB calls
    const selectSpyApiFail = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'select');
    assertExists(selectSpyApiFail, "Select spy for subscription_plans should exist (Stripe API fail case)");
    assertSpyCalls(selectSpyApiFail, 1);

    const eqSpyApiFail = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'eq');
    assertExists(eqSpyApiFail, "eq spy for subscription_plans should exist (Stripe API fail case)");
    assertSpyCalls(eqSpyApiFail, 1);

    const singleSpyApiFail = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'single');
    assertExists(singleSpyApiFail, "single spy for subscription_plans should exist (Stripe API fail case)");
    assertSpyCalls(singleSpyApiFail, 1);

    // Check Stripe calls
    assertSpyCalls(mockStripe.stubs.checkoutSessionsCreate, 1); // Session creation should still be called and succeed here
    assertSpyCalls(mockStripe.stubs.paymentIntentsRetrieve, 0); // This is where the error is thrown, so it won't complete successfully.
                                                              // If the mock is set to throw, callCount might be 1 or 0 depending on when it throws.
                                                              // The critical part is that the overall initiatePayment fails as expected.

    teardownMocks();
  });

  await t.step('initiatePayment - error: Stripe paymentIntents.retrieve fails', async () => {
    const basePurchaseRequest: PurchaseRequest = {
      userId: 'user-pi-retrieve-error',
      itemId: 'item-causes-pi-retrieve-error',
      quantity: 1,
      currency: 'USD',
      paymentGatewayId: 'stripe',
    };
    const context: PaymentOrchestrationContext = {
        ...basePurchaseRequest,
        internalPaymentId: 'ptxn_pi_retrieve_fail_002',
        targetWalletId: 'wallet_irrelevant_for_pi_error',
        tokensToAward: 600,
        amountForGateway: 30.00,
        currencyForGateway: 'USD',
    };

    const planData = { 
        stripe_price_id: 'price_causes_pi_error', 
        plan_type: 'one_time_purchase', 
    };
    const stripeSessionData = { 
      id: 'cs_test_pi_retrieve_error', 
      url: 'https://stripe.com/pay/pi_retrieve_error', 
      payment_intent: 'pi_to_fail_retrieve',
      object: 'checkout.session',
      status: 'open',
      livemode: false,
      lastResponse: { headers: {}, requestId: 'req_pi_retrieve_error', statusCode: 200 }
    } as Stripe.Response<Stripe.Checkout.Session>;

    const retrieveError = new Stripe.errors.StripeAPIError({ message: 'Simulated Stripe PaymentIntent retrieve error', type: 'api_error' });

    const supabaseConfig: MockSupabaseDataConfig = {
      genericMockResults: {
        'subscription_plans': {
          select: async (state: MockQueryBuilderState) => {
            if (state.filters.some(f => f.column === 'stripe_price_id' && f.value === context.itemId)) {
                return { data: [planData], error: null, count: 1, status: 200, statusText: 'OK' };
            }
            return { data: [], error: new Error('Mock: Plan not found in PI retrieve error test'), count: 0, status: 404, statusText: 'Not Found' };
          }
        },
      }
    };
    setupMocksAndAdapter(supabaseConfig);

    if (mockStripe.stubs.checkoutSessionsCreate?.restore) mockStripe.stubs.checkoutSessionsCreate.restore();
    mockStripe.stubs.checkoutSessionsCreate = stub(mockStripe.instance.checkout.sessions, "create", () => Promise.resolve(stripeSessionData));

    if (mockStripe.stubs.paymentIntentsRetrieve?.restore) mockStripe.stubs.paymentIntentsRetrieve.restore();
    mockStripe.stubs.paymentIntentsRetrieve = stub(mockStripe.instance.paymentIntents, "retrieve", () => Promise.reject(retrieveError));

    const result = await adapter.initiatePayment(context);

    assert(!result.success, 'Payment initiation should fail when PaymentIntent retrieve fails');
    assertEquals(result.error, retrieveError.message, "Error message should match the rejected PaymentIntent retrieve error");
    
    assertSpyCalls(mockStripe.stubs.checkoutSessionsCreate, 1);
    assertSpyCalls(mockStripe.stubs.paymentIntentsRetrieve, 1);

    // Check DB calls
    const selectSpyPiFail = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'select');
    assertExists(selectSpyPiFail, "Select spy for subscription_plans should exist (PI retrieve fail case)");
    assertSpyCalls(selectSpyPiFail, 1);

    const eqSpyPiFail = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'eq');
    assertExists(eqSpyPiFail, "eq spy for subscription_plans should exist (PI retrieve fail case)");
    assertSpyCalls(eqSpyPiFail, 1);

    const singleSpyPiFail = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'single');
    assertExists(singleSpyPiFail, "single spy for subscription_plans should exist (PI retrieve fail case)");
    assertSpyCalls(singleSpyPiFail, 1);

    // Check Stripe calls
    assertSpyCalls(mockStripe.stubs.checkoutSessionsCreate, 1);
    assertSpyCalls(mockStripe.stubs.paymentIntentsRetrieve, 1); // This is called, but the mock makes it throw an error

    teardownMocks();
  });

  await t.step('initiatePayment - happy path: subscription successfully initiates payment', async () => {
    const basePurchaseRequest: PurchaseRequest = {
      userId: 'user-happy-path-sub',
      itemId: 'item-sub-premium-plan',
      quantity: 1,
      currency: 'USD',
      paymentGatewayId: 'stripe',
      metadata: { test_run: 'happy-sub'}
    };

    const context: PaymentOrchestrationContext = {
      ...basePurchaseRequest,
      internalPaymentId: 'ptxn_happy_sub_789',
      targetWalletId: 'wallet_user_happy_sub',
      tokensToAward: 5000, // Example for a subscription
      amountForGateway: 25.00, // Example cost
      currencyForGateway: 'USD',
    };

    const planData = { 
      stripe_price_id: 'price_sub_premium', 
      plan_type: 'subscription', // Key for this test
    };

    const stripeSessionData = { 
      id: 'cs_test_happy_sub_123', 
      url: 'https://stripe.com/pay/happy_sub', 
      payment_intent: 'pi_happy_sub_789', 
      object: 'checkout.session',
      status: 'open',
      livemode: false,
      lastResponse: {
        headers: {},
        requestId: 'req_test_happy_sub',
        statusCode: 200,
        apiVersion: undefined,
        idempotencyKey: undefined,
        stripeAccount: undefined,
      }
    } as Stripe.Response<Stripe.Checkout.Session>; 

    const supabaseConfig: MockSupabaseDataConfig = {
      genericMockResults: {
        'subscription_plans': {
          select: async (state: MockQueryBuilderState) => {
            if (state.filters.some(f => f.column === 'stripe_price_id' && f.value === context.itemId)) {
              return { data: [planData], error: null, count: 1, status: 200, statusText: 'OK' };
            }
            const mockError = new Error('Mock: item_id_internal not found for subscription plan query');
            return { data: [], error: mockError, count: 0, status: 404, statusText: 'Not Found' };
          }
        },
      }
    };
    
    setupMocksAndAdapter(supabaseConfig);

    if (mockStripe.stubs.checkoutSessionsCreate?.restore) mockStripe.stubs.checkoutSessionsCreate.restore();
    mockStripe.stubs.checkoutSessionsCreate = stub(mockStripe.instance.checkout.sessions, "create", () => Promise.resolve(stripeSessionData));
    
    // Add stub for payment_intent retrieval for client_secret for subscription test
    const mockPaymentIntentSubData = {
      id: stripeSessionData.payment_intent as string, 
      client_secret: `${stripeSessionData.payment_intent}_secret_test_sub`
    };
    const mockPaymentIntentSubResponse = {
      ...mockPaymentIntentSubData,
      lastResponse: { headers: {}, requestId: 'req_test_sub', statusCode: 200 }
    } as Stripe.Response<Stripe.PaymentIntent>;

    if (mockStripe.stubs.paymentIntentsRetrieve?.restore) mockStripe.stubs.paymentIntentsRetrieve.restore();
    mockStripe.stubs.paymentIntentsRetrieve = stub(mockStripe.instance.paymentIntents, "retrieve", 
      () => Promise.resolve(mockPaymentIntentSubResponse)
    );
    
    const result = await adapter.initiatePayment(context);

    assert(result.success, `Subscription payment initiation should be successful. Error: ${result.error}`);
    assertEquals(result.transactionId, context.internalPaymentId);
    assertEquals(result.paymentGatewayTransactionId, stripeSessionData.id);
    assertEquals(result.redirectUrl, stripeSessionData.url ?? undefined);
    assertEquals(result.clientSecret, mockPaymentIntentSubData.client_secret, 'Incorrect clientSecret for subscription');
    
    const createCallArgs = mockStripe.stubs.checkoutSessionsCreate.calls[0]?.args[0] as Stripe.Checkout.SessionCreateParams;
    assert(createCallArgs, "Stripe session create was not called or args not captured");
    assertEquals(createCallArgs.mode, 'subscription', "Stripe session mode should be 'subscription'");
    assertEquals(createCallArgs.line_items?.[0].price, planData.stripe_price_id);
    assertEquals(createCallArgs.line_items?.[0].quantity, context.quantity);
    assertEquals(createCallArgs.metadata?.internal_payment_id, context.internalPaymentId);

    // mockTokenWalletService.getWalletForContext should not have been called by the adapter
    assertEquals(mockTokenWalletService.stubs.getWalletForContext.calls.length, 0, "getWalletForContext should not be called by adapter (sub)");
    assertEquals(mockTokenWalletService.stubs.createWallet.calls.length, 0, "createWallet should not be called by adapter (sub)");

    // Assert that subscription_plans was queried correctly
    assert(mockSupabaseSetup.spies.fromSpy.calls.some((call: SpyCall) => call.args[0] === 'subscription_plans'), "from('subscription_plans') should have been called (Sub).");
    
    const selectSpySub = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'select');
    assertExists(selectSpySub, "Select spy for subscription_plans should exist (Sub)");
    assertSpyCalls(selectSpySub, 1);

    const eqSpySub = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'eq');
    assertExists(eqSpySub, "eq spy for subscription_plans should exist (Sub)");
    assertSpyCalls(eqSpySub, 1);
    assertEquals(eqSpySub.calls[0].args, ['stripe_price_id', context.itemId], "eq on subscription_plans called with wrong arguments (Sub)");

    const singleSpySub = mockSupabaseSetup.client.getSpiesForTableQueryMethod('subscription_plans', 'single');
    assertExists(singleSpySub, "single spy for subscription_plans should exist (Sub)");
    assertSpyCalls(singleSpySub, 1);

    teardownMocks();
  });

  await t.step('initiatePayment - error: invalid or missing plan_type in fetched item details', async () => {
    const basePurchaseRequest: PurchaseRequest = {
      userId: 'user-invalid-plan-type',
      itemId: 'item-with-invalid-plan-type',
      quantity: 1,
      currency: 'USD',
      paymentGatewayId: 'stripe',
    };
    const context: PaymentOrchestrationContext = {
        ...basePurchaseRequest,
        internalPaymentId: 'ptxn_invalid_plan_type_456',
        targetWalletId: 'wallet_irrelevant_for_this_error',
        tokensToAward: 250,
        amountForGateway: 12.00,
        currencyForGateway: 'USD',
    };

    // Simulate planData with a missing plan_type
    const planDataMissingType = { 
        stripe_price_id: 'price_for_missing_type',
        // plan_type is deliberately missing
    }; 

    // Simulate planData with an invalid plan_type
    const planDataInvalidType = { 
        stripe_price_id: 'price_for_invalid_type',
        plan_type: 'some_unsupported_type',
    }; 

    const testScenarios = [
      { name: "missing plan_type", data: planDataMissingType, itemIdSuffix: "-missing"},
      { name: "invalid plan_type", data: planDataInvalidType, itemIdSuffix: "-invalid"},
    ];

    for (const scenario of testScenarios) {
      const currentItemId = `${context.itemId}${scenario.itemIdSuffix}`;
      const currentContext = { ...context, itemId: currentItemId, internalPaymentId: `${context.internalPaymentId}${scenario.itemIdSuffix}` };

      const supabaseConfig: MockSupabaseDataConfig = {
        genericMockResults: {
          'subscription_plans': {
            select: async (state: MockQueryBuilderState) => {
              if (state.filters.some(f => f.column === 'stripe_price_id' && f.value === currentItemId)) {
                  return { data: [scenario.data], error: null, count: 1, status: 200, statusText: 'OK' };
              }
              return { data: [], error: new Error('Mock: Plan not found in invalid plan_type test'), count: 0, status: 404, statusText: 'Not Found' };
            }
          },
        }
      };
      setupMocksAndAdapter(supabaseConfig);

      if (mockStripe.stubs.checkoutSessionsCreate?.restore) {
        mockStripe.stubs.checkoutSessionsCreate.restore();
      }
      // Spy on Stripe session creation to ensure it's not called.
      const checkoutCreateStub = stub(mockStripe.instance.checkout.sessions, "create", () => {
          throw new Error('Stripe checkout.sessions.create should not have been called!');
      });
      mockStripe.stubs.checkoutSessionsCreate = checkoutCreateStub;

      const result = await adapter.initiatePayment(currentContext);

      assert(!result.success, `Payment initiation should fail for scenario: ${scenario.name}`);
      
      // Determine the plan_type as the adapter would see it.
      // For the 'missing' scenario, scenario.data.plan_type would be undefined.
      // For the 'invalid' scenario, it would be the invalid string.
      const effectivePlanType = (scenario.data as any).plan_type; // Cast to any to access potentially missing property

      const expectedErrorMessage = `Invalid or missing plan_type: '${effectivePlanType}' received for item ID: ${currentItemId}. Cannot determine Stripe session mode.`;
      assertEquals(result.error, expectedErrorMessage, `Error message not as expected for ${scenario.name}`);
      assertEquals(result.transactionId, currentContext.internalPaymentId);
      assertSpyCalls(checkoutCreateStub, 0);

      teardownMocks(); // Teardown after each scenario to reset stubs
    }
  });

});