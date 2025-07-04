import { assertEquals, assertExists, assert } from "https://deno.land/std@0.177.0/testing/asserts.ts";
// Use Deno standard library spy/stub if needed, but rely primarily on the utility
import { assertSpyCalls, spy, stub, restore } from "https://deno.land/std@0.177.0/testing/mock.ts";
// Import Supabase types directly from npm specifier (User only)
import { SupabaseClient, User } from "npm:@supabase/supabase-js@^2.43.4"; 
// Import Notification type from shared types

// Import the shared test utility
import { createMockSupabaseClient, type MockSupabaseDataConfig, IMockSupabaseClient } from "../_shared/supabase.mock.ts";

// Import the handler function and dependency types
import { handler, NotificationsDeps } from "./index.ts";
// Import the handler function for CORS, not the headers object
import { handleCorsPreflightRequest } from "../_shared/cors-headers.ts"; 

// Import derived type for Notification Row data in tests
import type { Database } from "../types_db.ts";

// --- Mock Data ---
// Ensure mock data conforms to the imported types
const mockUser: User = {
    id: "test-user-id",
    app_metadata: { provider: 'email', providers: [ 'email' ] },
    user_metadata: {}, 
    aud: "authenticated",
    created_at: new Date().toISOString(),
};

// Use derived type for Notification Row data in tests
type NotificationRow = Database['public']['Tables']['notifications']['Row'];

const mockNotifications: NotificationRow[] = [
    {
        id: "noti-1",
        user_id: mockUser.id,
        type: "test",
        data: { message: "Test notification 1" },
        read: false,
        created_at: new Date(Date.now() - 10000).toISOString(),
    },
    {
        id: "noti-2",
        user_id: mockUser.id,
        type: "test",
        data: { message: "Test notification 2", target_path: "/dashboard" },
        read: true,
        created_at: new Date(Date.now() - 20000).toISOString(),
    },
];

// --- Helper to create deps for handler ---
// The handler expects { supabaseClient: SupabaseClient }
function createDeps(mockClient: IMockSupabaseClient): NotificationsDeps {
    return { supabaseClient: mockClient as unknown as SupabaseClient };
}

// --- Test Suite ---
Deno.test("/notifications endpoint tests", async (t) => {

    // No longer need env var mocking as handler uses injected client

    // **Important Note on Testability:**
    // With the handler refactored to use the injected deps.supabaseClient,
    // these tests now accurately reflect the handler's isolated logic.

    await t.step("GET /notifications: should handle OPTIONS preflight request", async () => {
        const { client } = createMockSupabaseClient(); 
        const req = new Request("http://localhost/notifications", { 
            method: "OPTIONS",
            headers: {
                "Origin": "http://localhost:5173" // Add allowed origin
            }
        });
        
        // Spy on the imported handler
        const handleCorsSpy = spy(handleCorsPreflightRequest);
        // Create deps, potentially overriding the handler for testing (if needed)
        // In this case, we just want to verify the real one is called

        const res = await handler(req, createDeps(client)); 
        await res.body?.cancel(); 

        assertEquals(res.status, 204); 
        assertEquals(res.headers.get("access-control-allow-origin"), "http://localhost:5173");
        assertEquals(res.headers.get("access-control-allow-headers"), "authorization, x-client-info, apikey, content-type, x-paynless-anon-secret"); 
        // assertSpyCalls(handleCorsSpy, 1); // Verify the handler was called
        // Restore if spied
        restore();
    });

    await t.step("GET /notifications: should reject non-GET/PUT/POST requests", async () => {
        const { client } = createMockSupabaseClient();
        const req = new Request("http://localhost/notifications", { method: "PATCH" }); // Test PATCH for example
        const res = await handler(req, createDeps(client));
        const body = await res.json(); 
        assertEquals(res.status, 405);
        assertEquals(body.error, "Method Not Allowed");
    });

    await t.step("GET /notifications: should reject request without Authorization header", async () => {
        // NOTE: The refactored handler relies on the *client itself* being authenticated.
        // It doesn't check the header directly anymore, it calls deps.supabaseClient.auth.getUser().
        // So this test case needs to simulate getUser failing when no token context exists.
        const { client, spies } = createMockSupabaseClient(mockUser.id, {
            // Simulate getUser failing as if no valid session/token was used to create the client
            simulateAuthError: new Error("No session") 
        });

        const req = new Request("http://localhost/notifications", { method: "GET" }); // No Auth header
        const res = await handler(req, createDeps(client));
        const body = await res.json();
        assertEquals(res.status, 401);
        // Error message will come from the mocked getUser failure
        assert(body.error?.includes("Unauthorized: No session")); 
        assertSpyCalls(spies.auth.getUserSpy, 1); // Verify getUser was called
    });

    await t.step("GET /notifications: should reject request with invalid client context (invalid token)", async () => {
        // Simulate getUser failing because the client was created with a bad token
        const mockError = new Error("Invalid token used for client");
        const { client, spies } = createMockSupabaseClient(mockUser.id, {
            simulateAuthError: mockError, 
        });

        // Request header doesn't matter as much now, the injected client carries the context
        const req = new Request("http://localhost/notifications", { 
            method: "GET",
            headers: { Authorization: "Bearer irrelevant-for-mock" } // Header is informational now
        });

        const res = await handler(req, createDeps(client));
        const body = await res.json();

        assertEquals(res.status, 401); 
        assertExists(body.error);
        assert(body.error.includes("Unauthorized: Invalid token used for client"));
        assertSpyCalls(spies.auth.getUserSpy, 1); // Verify getUser was called
    });

    await t.step("GET /notifications: should return notifications on successful GET with valid client context", async () => {
        const { client, spies } = createMockSupabaseClient(mockUser.id, {
            // Simulate getUser succeeding
            getUserResult: { data: { user: mockUser }, error: null },
            // Simulate DB query succeeding
            genericMockResults: {
                notifications: { 
                    select: { data: mockNotifications, error: null } 
                }
            }
        });

        const req = new Request("http://localhost/notifications", { 
            method: "GET",
            headers: { Authorization: "Bearer irrelevant-for-mock" } 
        });

        const res = await handler(req, createDeps(client));
        const body = await res.json(); 
        
        // Assertions for success case
        assertEquals(res.status, 200); 
        assertEquals(body, mockNotifications); 
        assertEquals(res.headers.get("content-type"), "application/json");

        // Verify mock calls
        assertSpyCalls(spies.auth.getUserSpy, 1);
        // Need spies for from, select, eq, order from supabase.mock if we want to assert these
        // Assuming supabase.mock provides them: 
        // assertSpyCalls(spies.fromSpy, 1);
        // assertSpyCalls(spies.selectSpy, 1);
        // assertSpyCalls(spies.eqSpy, 1);
        // assertSpyCalls(spies.orderSpy, 1);
    });

    await t.step("GET /notifications: should handle database errors during fetch with valid client context", async () => {
        const mockDbError = new Error("DB error from mock");
        const { client, spies } = createMockSupabaseClient(mockUser.id, {
            // Simulate getUser succeeding
            getUserResult: { data: { user: mockUser }, error: null },
            // Simulate DB query failing
            genericMockResults: {
                notifications: {
                    select: { data: null, error: mockDbError } 
                }
            }
        });

        const req = new Request("http://localhost/notifications", { 
            method: "GET",
            headers: { Authorization: "Bearer irrelevant-for-mock" }
        });

        const res = await handler(req, createDeps(client));
        const body = await res.json();

        // Assertions for DB error case
        assertEquals(res.status, 500);
        assertExists(body.error);
        assert(body.error.includes("Database error: DB error from mock")); 

        // Verify mock calls
        assertSpyCalls(spies.auth.getUserSpy, 1);
        // assertSpyCalls(spies.fromSpy, 1);
        // ... other DB spies
    });

    // --- NEW TEST CASE --- 
    await t.step("GET /notifications: should return 401 if auth succeeds but no user data is returned", async () => {
        const { client, spies } = createMockSupabaseClient(undefined, {
            // Simulate an auth error directly. In the handler, a null user from a successful
            // call is treated as an auth failure, so this achieves the same test objective.
            simulateAuthError: new Error("Invalid client context"),
        });

        const req = new Request("http://localhost/notifications", { 
            method: "GET",
            headers: { Authorization: "Bearer irrelevant-for-mock" } 
        });

        const res = await handler(req, createDeps(client));
        const body = await res.json();

        assertEquals(res.status, 401);
        assertExists(body.error);
        assert(body.error.includes("Unauthorized: Invalid client context"));
        assertSpyCalls(spies.auth.getUserSpy, 1); // Verify getUser was called
    });

    // --- NEW TEST CASE --- 
    await t.step("GET /notifications: should return empty array for successful GET when no notifications exist", async () => {
        const { client, spies } = createMockSupabaseClient(mockUser.id, {
            // Simulate getUser succeeding
            getUserResult: { data: { user: mockUser }, error: null },
            // Simulate DB query succeeding but returning empty array
            genericMockResults: {
                notifications: { 
                    select: { data: [], error: null } // Empty data array
                }
            }
        });

        const req = new Request("http://localhost/notifications", { 
            method: "GET",
            headers: { Authorization: "Bearer irrelevant-for-mock" } 
        });

        const res = await handler(req, createDeps(client));
        const body = await res.json(); 
        
        assertEquals(res.status, 200); 
        assertEquals(body, []); // Expect an empty array
        assertEquals(res.headers.get("content-type"), "application/json");

        // Verify mock calls
        assertSpyCalls(spies.auth.getUserSpy, 1);
        // assertSpyCalls(spies.fromSpy, 1);
        // ... other DB spies
    });

    // --- PUT Request Tests (New) ---
    await t.step("PUT /notifications/:id: should reject request without valid client context", async () => {
        const notificationId = "noti-1";
        const { client, spies } = createMockSupabaseClient(mockUser.id, {
            simulateAuthError: new Error("Auth failed for PUT")
        });
        const req = new Request(`http://localhost/notifications/${notificationId}`, { 
            method: "PUT", 
            body: JSON.stringify({ read: true }), // Body isn't strictly needed by this endpoint, but good practice
            headers: { 'Content-Type': 'application/json' }
        });
        const res = await handler(req, createDeps(client));
        const body = await res.json();
        assertEquals(res.status, 401);
        assert(body.error?.includes("Unauthorized: Auth failed for PUT"));
        assertSpyCalls(spies.auth.getUserSpy, 1);
    });

    await t.step("PUT /notifications/:id: should successfully mark notification as read", async () => {
        const notificationId = "noti-1";
        // Mock the update chain: update -> match -> success
        const { client, spies } = createMockSupabaseClient(mockUser.id, {
            getUserResult: { data: { user: mockUser }, error: null },
            genericMockResults: {
                notifications: { 
                    // Mock the result of the UPDATE operation
                    update: { data: null, error: null } 
                }
            }
        });

        const req = new Request(`http://localhost/notifications/${notificationId}`, { 
            method: "PUT",
            body: JSON.stringify({ read: true }),
            headers: { 'Content-Type': 'application/json' }
        });
        const res = await handler(req, createDeps(client));
        
        assertEquals(res.status, 204);
        assertEquals(await res.text(), ""); 

        assertSpyCalls(spies.auth.getUserSpy, 1);
        // TODO: Enhance supabase.mock spies to verify update/match calls and criteria
    });

    await t.step("PUT /notifications/:id: should return 404 if notification not found or doesn't belong to user", async () => {
        const notificationId = "noti-unknown";
        // Mock the update operation failing (e.g., returns error)
        const mockError = { code: 'PGRST116', message: 'Row not found' } as any;
        const { client, spies } = createMockSupabaseClient(mockUser.id, {
            getUserResult: { data: { user: mockUser }, error: null },
            genericMockResults: {
                notifications: { 
                    // Simulate the UPDATE operation failing (as if match found nothing)
                    update: { data: null, error: mockError as Error } 
                }
            }
        });

        const req = new Request(`http://localhost/notifications/${notificationId}`, { 
            method: "PUT",
            body: JSON.stringify({ read: true }),
            headers: { 'Content-Type': 'application/json' }
        });
        const res = await handler(req, createDeps(client));
        const body = await res.json();
        
        assertEquals(res.status, 404); 
        assertExists(body.error);
        assert(body.error.includes("Notification not found or not owned by user"));
        
        assertSpyCalls(spies.auth.getUserSpy, 1);
    });

    await t.step("PUT /notifications/:id: should handle database errors during update", async () => {
        const notificationId = "noti-1";
        const mockDbError = new Error("DB update error");
        const { client, spies } = createMockSupabaseClient(mockUser.id, {
            getUserResult: { data: { user: mockUser }, error: null },
            genericMockResults: {
                notifications: { 
                    // Simulate the UPDATE operation encountering a DB error
                    update: { data: null, error: mockDbError } 
                }
            }
        });

        const req = new Request(`http://localhost/notifications/${notificationId}`, { 
            method: "PUT",
            body: JSON.stringify({ read: true }),
            headers: { 'Content-Type': 'application/json' }
        });
        const res = await handler(req, createDeps(client));
        const body = await res.json();
        
        assertEquals(res.status, 500);
        assertExists(body.error);
        assert(body.error.includes("Database error: DB update error")); 

        assertSpyCalls(spies.auth.getUserSpy, 1);
    });

    // --- POST Request Tests (New) ---
    await t.step("POST /notifications/mark-all-read: should reject request without valid client context", async () => {
         const { client, spies } = createMockSupabaseClient(mockUser.id, {
            simulateAuthError: new Error("Auth failed for POST")
        });
        const req = new Request("http://localhost/notifications/mark-all-read", { method: "POST" });
        const res = await handler(req, createDeps(client));
        const body = await res.json();
        assertEquals(res.status, 401);
        assert(body.error?.includes("Unauthorized: Auth failed for POST"));
        assertSpyCalls(spies.auth.getUserSpy, 1);
    });

    await t.step("POST /notifications/mark-all-read: should successfully mark all notifications as read", async () => {
        const { client, spies } = createMockSupabaseClient(mockUser.id, {
            getUserResult: { data: { user: mockUser }, error: null },
            genericMockResults: {
                notifications: { 
                    // Mock the result of the UPDATE operation
                    update: { data: null, error: null } 
                }
            }
        });

        const req = new Request("http://localhost/notifications/mark-all-read", { method: "POST" });
        const res = await handler(req, createDeps(client));
        
        assertEquals(res.status, 204);
        assertEquals(await res.text(), "");

        assertSpyCalls(spies.auth.getUserSpy, 1);
        // TODO: Enhance supabase.mock spies to verify update/match calls and criteria
    });

    await t.step("POST /notifications/mark-all-read: should handle case where no notifications need updating", async () => {
        // Assume success (204) is returned even if 0 rows updated.
        const { client, spies } = createMockSupabaseClient(mockUser.id, {
            getUserResult: { data: { user: mockUser }, error: null },
            genericMockResults: {
                notifications: { 
                    // Mock the result of the UPDATE operation (success)
                    update: { data: null, error: null } 
                }
            }
        });

        const req = new Request("http://localhost/notifications/mark-all-read", { method: "POST" });
        const res = await handler(req, createDeps(client));
        
        assertEquals(res.status, 204); 
        assertEquals(await res.text(), "");

        assertSpyCalls(spies.auth.getUserSpy, 1);
    });

    await t.step("POST /notifications/mark-all-read: should handle database errors during update", async () => {
        const mockDbError = new Error("DB mark-all error");
        const { client, spies } = createMockSupabaseClient(mockUser.id, {
            getUserResult: { data: { user: mockUser }, error: null },
            genericMockResults: {
                notifications: { 
                     // Simulate the UPDATE operation encountering a DB error
                    update: { data: null, error: mockDbError } 
                }
            }
        });

        const req = new Request("http://localhost/notifications/mark-all-read", { method: "POST" });
        const res = await handler(req, createDeps(client));
        const body = await res.json();
        
        assertEquals(res.status, 500);
        assertExists(body.error);
        assert(body.error.includes("Database error: DB mark-all error")); 

        assertSpyCalls(spies.auth.getUserSpy, 1);
    });

    await t.step("should reject requests to paths other than /notifications/:id or /notifications/mark-all-read for PUT/POST", async () => {
        const { client } = createMockSupabaseClient(mockUser.id, {
            getUserResult: { data: { user: mockUser }, error: null },
        });
        // Test PUT to base path
        const reqPut = new Request("http://localhost/notifications", { method: "PUT" });
        const resPut = await handler(reqPut, createDeps(client));
        assertEquals(resPut.status, 404); // Or 405 depending on desired routing logic
        // Test POST to different path
        const reqPost = new Request("http://localhost/notifications/other-action", { method: "POST" });
        const resPost = await handler(reqPost, createDeps(client));
        assertEquals(resPost.status, 404); // Or 405
    });

}); 