import { assertEquals, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { DummyAdapter, type DummyAdapterConfig } from "./dummy_adapter.ts";
import type { ChatApiRequest, ILogger, TokenUsage, AiModelExtendedConfig } from "../types.ts";

const mockLogger: ILogger = {
    debug: (message: string, metadata?: object) => { console.debug("DEBUG:", message, metadata); },
    info: (message: string, metadata?: object) => { console.info("INFO:", message, metadata); },
    warn: (message: string, metadata?: object) => { console.warn("WARN:", message, metadata); },
    error: (message: string | Error, metadata?: object) => { console.error("ERROR:", message, metadata); },
};

// Consistent name for the template
const baseChatRequestData: Omit<ChatApiRequest, 'message' | 'providerId' | 'messages'> = {
    promptId: "__none__",
}; 

Deno.test("DummyAdapter - Echo Mode - Basic Echo", async () => {
    const testConfig: DummyAdapterConfig = {
        modelId: "dummy-echo-test-basic",
        mode: "echo",
        tokensPerChar: 0.25,
        basePromptTokens: 10,
        tokenization_strategy: { type: 'tiktoken', tiktoken_encoding_name: 'cl100k_base' }
    };
    const adapter = new DummyAdapter(testConfig, mockLogger);
    const currentMessage = "Hello world";
    const chatRequest: ChatApiRequest = {
        ...baseChatRequestData,
        messages: [{ role: "user", content: "Previous message" }],
        message: currentMessage,
        providerId: "test-provider-id-echo-basic",
    };

    const response = await adapter.sendMessage(chatRequest, testConfig.modelId);

    assertEquals(response.content, `Echo: ${currentMessage}`);
    assertEquals(response.role, "assistant");
    assertEquals(response.ai_provider_id, chatRequest.providerId);
    
    const tokenUsage = response.token_usage as unknown as TokenUsage;
    
    // Updated calculation to include historical messages for prompt tokens
    const historicalMessages = chatRequest.messages ?? []; // Default to empty array if undefined
    const historyContent = historicalMessages.map(m => m.content).join('\n');
    const historyTokens = historicalMessages.length > 0 ? Math.ceil(historyContent.length * (testConfig.tokensPerChar ?? 0)) : 0;

    const expectedPromptTokens = 
        (testConfig.basePromptTokens ?? 0) + 
        historyTokens + 
        Math.ceil((chatRequest.message?.length ?? 0) * (testConfig.tokensPerChar ?? 0));

    assertEquals(tokenUsage?.prompt_tokens, expectedPromptTokens);
    const expectedCompletionTokens = Math.ceil(response.content.length * (testConfig.tokensPerChar ?? 0));
    assertEquals(tokenUsage?.completion_tokens, expectedCompletionTokens);
    assertEquals(tokenUsage?.total_tokens, expectedPromptTokens + expectedCompletionTokens);
    assertEquals(tokenUsage.finish_reason, 'stop'); // Assert it stops correctly on a short response
});

Deno.test("DummyAdapter - Echo Mode - No Message, No History", async () => {
    const testConfig: DummyAdapterConfig = {
        modelId: "dummy-echo-no-message",
        mode: "echo",
        tokensPerChar: 0.25, 
        basePromptTokens: 10,
        tokenization_strategy: { type: 'tiktoken', tiktoken_encoding_name: 'cl100k_base' }
    };
    const adapter = new DummyAdapter(testConfig, mockLogger);
    const chatRequest: ChatApiRequest = {
        ...baseChatRequestData,
        messages: [],
        message: "",
        providerId: "test-provider-id-echo-no-message",
    };

    const response = await adapter.sendMessage(chatRequest, testConfig.modelId);
    const tokenUsageEchoNoMsg = response.token_usage as unknown as TokenUsage;

    assertEquals(response.content, "Echo: No message provided");
    assertEquals(tokenUsageEchoNoMsg?.prompt_tokens, testConfig.basePromptTokens);
    const expectedCompletionTokensEchoNoMsg = Math.ceil(response.content.length * (testConfig.tokensPerChar ?? 0));
    assertEquals(tokenUsageEchoNoMsg?.completion_tokens, expectedCompletionTokensEchoNoMsg);
    assertEquals(tokenUsageEchoNoMsg.finish_reason, 'stop');
});

Deno.test("DummyAdapter - Fixed Response Mode - Basic Fixed Response", async () => {
    const fixedContent = "This is a predetermined answer for fixed response test.";
    const testConfig: DummyAdapterConfig = {
        modelId: "dummy-fixed-test-basic",
        mode: "fixed_response",
        fixedResponse: {
            content: fixedContent,
            promptTokens: 50,
            completionTokens: 15,
        },
        tokenization_strategy: { type: 'tiktoken', tiktoken_encoding_name: 'cl100k_base' }
    };
    const adapter = new DummyAdapter(testConfig, mockLogger);
    const chatRequest: ChatApiRequest = {
        ...baseChatRequestData,
        messages: [{ role: "user", content: "User question, will be ignored." }],
        message: "Another user question, also ignored.",
        providerId: "test-provider-id-fixed-basic",
    };

    const response = await adapter.sendMessage(chatRequest, testConfig.modelId);

    assertEquals(response.content, fixedContent);
    assertEquals(response.role, "assistant");
    assertEquals(response.ai_provider_id, chatRequest.providerId);

    const tokenUsageFixedBasic = response.token_usage as unknown as TokenUsage;
    assertEquals(tokenUsageFixedBasic?.prompt_tokens, 50);
    assertEquals(tokenUsageFixedBasic?.completion_tokens, 15);
    assertEquals(tokenUsageFixedBasic?.total_tokens, 65);
    assertEquals(tokenUsageFixedBasic.finish_reason, 'stop');
});

Deno.test("DummyAdapter - Fixed Response Mode - Default token calculation", async () => {
    const fixedContent = "Fixed answer with default token calculation.";
    const testConfig: DummyAdapterConfig = {
        modelId: "dummy-fixed-default-tokens-test",
        mode: "fixed_response",
        fixedResponse: {
            content: fixedContent, // promptTokens & completionTokens will be calculated by adapter
        },
        tokensPerChar: 0.3, 
        basePromptTokens: 8,
        tokenization_strategy: { type: 'tiktoken', tiktoken_encoding_name: 'cl100k_base' }
    };
    const adapter = new DummyAdapter(testConfig, mockLogger);
    const userMessageContent = "Query for default token calc in fixed response.";
    const historyMessageContent = "History for default token calc in fixed response.";
    const chatRequest: ChatApiRequest = {
        ...baseChatRequestData,
        messages: [{ role: "user", content: historyMessageContent }],
        message: userMessageContent,
        providerId: "test-provider-id-fixed-default-tokens",
    };
    
    // Calculation based on DummyAdapter logic
    const fullInputForCalc = ((chatRequest.messages ?? []).map(m => m.content).join('\\n') + '\\n' + chatRequest.message);
    const expectedPromptTokensDefault = (testConfig.basePromptTokens ?? 0) + Math.ceil(fullInputForCalc.length * (testConfig.tokensPerChar ?? 0));
    const expectedCompletionTokensDefault = Math.ceil(fixedContent.length * (testConfig.tokensPerChar ?? 0));

    const response = await adapter.sendMessage(chatRequest, testConfig.modelId);
    const tokenUsageFixedDefault = response.token_usage as unknown as TokenUsage;

    assertEquals(response.content, fixedContent);
    assertEquals(tokenUsageFixedDefault?.prompt_tokens, expectedPromptTokensDefault);
    assertEquals(tokenUsageFixedDefault?.completion_tokens, expectedCompletionTokensDefault);
    assertEquals(tokenUsageFixedDefault?.total_tokens, expectedPromptTokensDefault + expectedCompletionTokensDefault);
    assertEquals(tokenUsageFixedDefault.finish_reason, 'stop');
});

Deno.test("DummyAdapter - listModels Method", async () => {
    const echoConfig: DummyAdapterConfig = {
        modelId: "dummy-model-for-listing-echo",
        mode: "echo",
        tokenization_strategy: { type: 'tiktoken', tiktoken_encoding_name: 'cl100k_base' }
    };
    const echoAdapter = new DummyAdapter(echoConfig, mockLogger);
    const echoModels = await echoAdapter.listModels();
    assertEquals(echoModels.length, 1);
    assertEquals(echoModels[0].api_identifier, echoConfig.modelId);
    assertEquals(echoModels[0].name, `Dummy Model (echo) - ${echoConfig.modelId}`);

    const fixedConfig: DummyAdapterConfig = {
        modelId: "dummy-model-for-listing-fixed",
        mode: "fixed_response",
        fixedResponse: { content: "Fixed response for listModels test" },
        tokenization_strategy: { type: 'tiktoken', tiktoken_encoding_name: 'cl100k_base' }
    };
    const fixedAdapter = new DummyAdapter(fixedConfig, mockLogger);
    const fixedModels = await fixedAdapter.listModels();
    assertEquals(fixedModels.length, 1);
    assertEquals(fixedModels[0].api_identifier, fixedConfig.modelId);
    assertEquals(fixedModels[0].name, `Dummy Model (fixed_response) - ${fixedConfig.modelId}`);
}); 

Deno.test("DummyAdapter - Invalid Mode throws error during sendMessage", async () => {
    const invalidConfig = {
        modelId: "dummy-invalid-mode-test",
        mode: "non_existent_mode", 
        tokenization_strategy: { type: 'tiktoken', tiktoken_encoding_name: 'cl100k_base' }
    } as unknown as DummyAdapterConfig; // Cast to allow testing invalid mode
    const adapter = new DummyAdapter(invalidConfig, mockLogger);
    const chatRequest: ChatApiRequest = {
        ...baseChatRequestData,
        messages: [],
        message: "Test message for the invalid mode scenario",
        providerId: "test-provider-id-invalid-mode",
    };

    try {
        await adapter.sendMessage(chatRequest, invalidConfig.modelId);
        // If sendMessage does not throw, this line will be reached, failing the test.
        assertEquals(true, false, "Expected adapter.sendMessage to throw an error for invalid mode.");
    } catch (e) {
        assertEquals(e instanceof Error, true, "Caught error should be an instance of Error");
        if (e instanceof Error) { // Type guard for TypeScript
            assertEquals(e.message, `DummyAdapter: Unknown mode '${invalidConfig.mode}'`, "Error message mismatch.");
        } else {
            // Should not happen if the above assertEquals(e instanceof Error, true) passes
            assertEquals(true, false, "Caught something that was not an Error instance.");
        }
    }
}); 

Deno.test("DummyAdapter - Input Token Limit Exceeded", async () => {
    const testConfig: DummyAdapterConfig = {
        modelId: "dummy-input-limit-test",
        mode: "echo",
        tokensPerChar: 1,
        basePromptTokens: 5,
        provider_max_input_tokens: 20,
        tokenization_strategy: { type: 'tiktoken', tiktoken_encoding_name: 'cl100k_base' }
    };
    const adapter = new DummyAdapter(testConfig, mockLogger);
    const chatRequest: ChatApiRequest = {
        ...baseChatRequestData,
        message: "This message is definitely too long.",
        providerId: "test-provider-id-input-limit",
        messages: [{role: 'user', content: 'This message is definitely too long.'}]
    };

    try {
        await adapter.sendMessage(chatRequest, testConfig.modelId);
        // If it doesn't throw, the test fails.
        assertEquals(true, false, "Expected sendMessage to throw an error but it did not.");
    } catch (e) {
        if (e instanceof Error) {
            assertEquals(e.message, `Input prompt exceeds the model's maximum context size of 20 tokens.`);
        } else {
            // Fail if the caught object is not an error
            assertEquals(true, false, "Caught something that was not an Error instance.");
        }
    }
});

Deno.test("DummyAdapter - Simulates multi-part continuation correctly", async () => {
    const fullContent = "This is the full, long response that requires continuation."; // 60 chars
    const testConfig: DummyAdapterConfig = {
        modelId: "dummy-continuation-test",
        mode: "fixed_response",
        fixedResponse: { content: fullContent },
        tokensPerChar: 1, // 1 char = 1 token
        provider_max_output_tokens: 20, // Send in chunks of 20
        tokenization_strategy: { type: 'tiktoken', tiktoken_encoding_name: 'cl100k_base' }
    };
    const adapter = new DummyAdapter(testConfig, mockLogger);
    const providerId = "test-provider-id-continuation";

    // --- First call ---
    const initialRequest: ChatApiRequest = {
        ...baseChatRequestData,
        message: "Start the process.",
        providerId,
        messages: [{ role: 'user', content: 'Start the process.' }]
    };

    const response1 = await adapter.sendMessage(initialRequest, testConfig.modelId);
    assertEquals(response1.content, "This is the full, lo"); // 20 chars
    assertEquals((response1.token_usage as unknown as TokenUsage).finish_reason, "length");

    // --- Second call ---
    const secondRequest: ChatApiRequest = {
        ...initialRequest,
        messages: [ // History now includes the first partial response
            { role: 'user', content: 'Start the process.' },
            { role: 'assistant', content: response1.content }
        ]
    };

    const response2 = await adapter.sendMessage(secondRequest, testConfig.modelId);
    assertEquals(response2.content, "ng response that req"); // 20 chars
    assertEquals((response2.token_usage as unknown as TokenUsage).finish_reason, "length");

    // --- Third call ---
    const thirdRequest: ChatApiRequest = {
        ...initialRequest,
        messages: [ // History includes both partial responses
            { role: 'user', content: 'Start the process.' },
            { role: 'assistant', content: response1.content },
            { role: 'assistant', content: response2.content }
        ]
    };

    const response3 = await adapter.sendMessage(thirdRequest, testConfig.modelId);
    assertEquals(response3.content, "uires continuation."); // 20 chars
    assertEquals((response3.token_usage as unknown as TokenUsage).finish_reason, "stop");
    
    // --- Verify total content ---
    const finalContent = response1.content + response2.content + response3.content;
    assertEquals(finalContent, fullContent);
}); 