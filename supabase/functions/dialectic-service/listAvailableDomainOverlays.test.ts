import { assertEquals, assertRejects, assertExists, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { describe, it, beforeEach, afterEach } from "https://deno.land/std@0.190.0/testing/bdd.ts"; // Using BDD for structure
import { stub, type Stub } from "https://deno.land/std@0.190.0/testing/mock.ts";
import { listAvailableDomainOverlays } from "./listAvailableDomainOverlays.ts";
import type { DomainOverlayDescriptor } from './dialectic.interface.ts'; 
import { 
    createMockSupabaseClient,
    type MockSupabaseDataConfig,
    type IMockSupabaseClient,
    type IMockClientSpies 
} from '../_shared/supabase.mock.ts';
import * as sharedLogger from "../_shared/logger.ts"; // For stubbing logger if logic uses it

describe("listAvailableDomainOverlays", () => {
  let currentMockDbClient: IMockSupabaseClient;
  let currentClientSpies: IMockClientSpies;
  let supabaseTestSetup: ReturnType<typeof createMockSupabaseClient>;
  let loggerWarnStub: Stub<typeof sharedLogger.logger>;
  let loggerErrorStub: Stub<typeof sharedLogger.logger>;

  // Helper to set up or re-initialize ONLY Supabase mocks
  const initializeSupabaseMocks = (config: MockSupabaseDataConfig) => {
    if (supabaseTestSetup && supabaseTestSetup.clearAllStubs) {
      supabaseTestSetup.clearAllStubs();
    }
    supabaseTestSetup = createMockSupabaseClient("test-user", config);
    currentMockDbClient = supabaseTestSetup.client;
    currentClientSpies = supabaseTestSetup.spies;
  };

  beforeEach(() => {
    // Create fresh logger stubs for each test
    loggerWarnStub = stub(sharedLogger.logger, "warn", () => {});
    loggerErrorStub = stub(sharedLogger.logger, "error", () => {});
    
    // Initial default Supabase mock setup for every test.
    // Specific tests can call initializeSupabaseMocks again if they need a different config.
    initializeSupabaseMocks({}); 
  });

  afterEach(() => {
    // Restore logger stubs
    loggerWarnStub.restore();
    loggerErrorStub.restore();
    
    // Clear Supabase stubs
    if (supabaseTestSetup && supabaseTestSetup.clearAllStubs) {
      supabaseTestSetup.clearAllStubs();
    }
  });

  it("should return correctly mapped DomainOverlayDescriptors for a valid stageAssociation", async () => {
    const mockDbResponseData = [
      {
        id: "overlay-uuid-1",
        domain_id: "tech_writing",
        description: "Technical Writing Standards",
        overlay_values: { detail: "some tech details" },
        is_active: true,
        system_prompts: [{ stage_association: "thesis", is_active: true }],
      },
      {
        id: "overlay-uuid-2",
        domain_id: "legal_drafting",
        description: "Legal Document Templates",
        overlay_values: null,
        is_active: true,
        system_prompts: [{ stage_association: "thesis", is_active: true }],
      },
    ];
    // Set up specific Supabase mocks for this test
    initializeSupabaseMocks({
      genericMockResults: {
        'domain_specific_prompt_overlays': {
          select: async () => ({ data: mockDbResponseData, error: null, count: mockDbResponseData.length, status: 200, statusText: 'OK' })
        }
      }
    });

    const result = await listAvailableDomainOverlays("thesis", currentMockDbClient as any);

    assertEquals(result.length, 2);
    assertEquals(result[0].id, "overlay-uuid-1");
    assertEquals(result[0].domainId, "tech_writing");
    assertEquals(result[0].description, "Technical Writing Standards");
    assertEquals(result[0].overlay_values, { detail: "some tech details" });
    assertEquals(result[0].stageAssociation, "thesis");
    assertEquals(result[1].id, "overlay-uuid-2");
    assertEquals(result[1].domainId, "legal_drafting");
    assertEquals(result[1].overlay_values, null);
    assertEquals(result[1].stageAssociation, "thesis");

    const fromSpy = currentClientSpies.fromSpy;
    const qbSpies = currentClientSpies.getLatestQueryBuilderSpies('domain_specific_prompt_overlays');
    assertExists(fromSpy, "fromSpy should exist");
    assertExists(qbSpies?.select, "Select spy should exist");
    assertExists(qbSpies?.eq, "Eq spy should exist");

    assertEquals(fromSpy.calls.length, 1);
    assertEquals(fromSpy.calls[0].args[0], 'domain_specific_prompt_overlays');
    assertEquals(qbSpies.select.calls.length, 1);
    assertEquals(qbSpies.select.calls[0].args[0], 'id, domain_id, description, overlay_values, is_active, system_prompts!inner(stage_association, is_active)');
    const eqCalls = qbSpies.eq.calls.map((call: any) => call.args); 
    assertExists(eqCalls.find((args: any[]) => args[0] === 'system_prompts.stage_association' && args[1] === 'thesis'));
    assertExists(eqCalls.find((args: any[]) => args[0] === 'is_active' && args[1] === true));
    assertExists(eqCalls.find((args: any[]) => args[0] === 'system_prompts.is_active' && args[1] === true));
  });

  it("should return an empty array if no overlays match the stageAssociation (DB returns empty)", async () => {
    initializeSupabaseMocks({
      genericMockResults: {
        'domain_specific_prompt_overlays': {
          select: async () => ({ data: [], error: null, count: 0, status: 200, statusText: 'OK' })
        }
      }
    });
    const result = await listAvailableDomainOverlays("non_existent_stage", currentMockDbClient as any);
    assertEquals(result.length, 0);
  });

  it("should return an empty array if logic is called with no stageAssociation", async () => {
    // Uses default Supabase mocks from beforeEach.
    const result = await listAvailableDomainOverlays("", currentMockDbClient as any);
    assertEquals(result.length, 0);
    assertEquals(loggerWarnStub.calls.length, 1);
    assertStringIncludes(loggerWarnStub.calls[0].args[0] as string, 'Called without stageAssociation');
  });

  it("should throw an error if the database call fails", async () => {
    const dbError = { message: "Network Error", details: "Failed to connect to DB", hint: "", code: "DB001" };
    initializeSupabaseMocks({
      genericMockResults: {
        'domain_specific_prompt_overlays': {
          select: async () => ({ data: null, error: dbError as any, count: 0, status: 500, statusText: 'Internal Server Error' })
        }
      }
    });

    const result = await listAvailableDomainOverlays("any_stage", currentMockDbClient as any);
    assertEquals(result.length, 0);

    assertEquals(loggerErrorStub.calls.length, 1);
    const logArgs = loggerErrorStub.calls[0].args;
    assertStringIncludes(logArgs[0] as string, '[listAvailableDomainOverlays] Error fetching from Supabase:');
    
    // Check specific properties of the logged errorDetails object
    assertExists((logArgs[1] as { errorDetails: Error }).errorDetails);
    assertEquals(((logArgs[1] as { errorDetails: Error }).errorDetails as Error).message, dbError.message);
    // If you also want to check the code, assuming your mock error object includes it directly on the Error instance or a sub-property
    // For instance, if the mock directly assigns the code to the error object:
    // assertEquals(((logArgs[1] as { errorDetails: any }).errorDetails).code, dbError.code);
  });

  it("should return an empty array if DB returns data but system_prompts is null or empty (data integrity issue)", async () => {
    const mockDbResponseData = [
      { id: "overlay-uuid-bad-1", domain_id: "bad_data_null", description: "system_prompts is null", is_active: true, system_prompts: null },
      { id: "overlay-uuid-bad-2", domain_id: "bad_data_empty", description: "system_prompts is empty array", is_active: true, system_prompts: [] },
    ];
    initializeSupabaseMocks({
      genericMockResults: {
        'domain_specific_prompt_overlays': {
          select: async () => ({ data: mockDbResponseData, error: null, count: mockDbResponseData.length, status: 200, statusText: 'OK' })
        }
      }
    });

    const result = await listAvailableDomainOverlays("thesis", currentMockDbClient as any);
    assertEquals(result.length, 0);
  });
});
