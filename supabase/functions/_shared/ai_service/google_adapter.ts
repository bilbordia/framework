import type { 
    AiProviderAdapter, 
    // REMOVED: ChatMessage, // Not returned directly
    ProviderModelInfo, 
    ChatApiRequest, 
    AdapterResponsePayload
} from '../types.ts';
import type { Json } from '../../../functions/types_db.ts';
// REMOVED: import type { VertexAI } from 'npm:@google-cloud/vertexai'; // Remove unused import

// Google Gemini API constants
const GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Helper type for Google Gemini API content structure
interface GoogleContentPart {
    text: string;
}
interface GoogleContent {
    role: 'user' | 'model'; // Gemini uses 'model' for assistant
    parts: GoogleContentPart[];
}

// Minimal interface for Google Model items
interface GoogleModelItem {
  name: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  // Add other fields if needed
  [key: string]: unknown;
}

/**
 * Implements AiProviderAdapter for Google Gemini models.
 */
export class GoogleAdapter implements AiProviderAdapter {

  private async _countTokens(
    modelApiName: string,
    apiKey: string,
    contents: GoogleContent[],
    fetchFn: typeof fetch = fetch // Allow fetch to be injectable for testing
  ): Promise<number | null> {
    const countTokensUrl = `${GOOGLE_API_BASE}/${modelApiName}:countTokens?key=${apiKey}`;
    console.log(`Counting tokens for model: ${modelApiName} with ${contents.length} content blocks.`);
    try {
      const response = await fetchFn(countTokensUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contents }), // API expects { "contents": [...] }
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`Google Gemini API error during countTokens (${response.status}): ${errorBody}`);
        // Do not throw here, allow main sendMessage to proceed with null tokens
        return null;
      }
      const jsonResponse = await response.json();
      return jsonResponse.totalTokens as number;
    } catch (error) {
      console.error('Failed to count tokens:', error);
      return null;
    }
  }

  async sendMessage(
    request: ChatApiRequest,
    modelIdentifier: string, // e.g., "google-gemini-1.5-pro-latest"
    apiKey: string
  ): Promise<AdapterResponsePayload> {
    // Map our internal identifier to Google's format (e.g., "models/gemini-1.5-pro-latest")
    const modelApiName = `models/${modelIdentifier.replace(/^google-/i, '')}`;
    const generateContentUrl = `${GOOGLE_API_BASE}/${modelApiName}:generateContent?key=${apiKey}`;

    // --- Map messages to Google Gemini format ---
    // Gemini uses alternating 'user' and 'model' roles.
    // System prompts are typically included in the first user message content.
    let systemPrompt = '';
    const googleContents: GoogleContent[] = [];

    // Combine history and new message
    const combinedMessages = [...(request.messages ?? [])];
    if (request.message) {
        combinedMessages.push({ role: 'user', content: request.message });
    }

    let lastRole: 'user' | 'assistant' | 'system' | null = null;
    let currentContent: GoogleContent | null = null;

    for (const message of combinedMessages) {
        if (message.role === 'system' && message.content) {
            // Prepend system prompt to the *next* user message
            systemPrompt = message.content;
            lastRole = 'system'; // Mark system prompt presence
        } else if (message.role === 'user') {
            if (lastRole !== 'user') { // Start new user content block
                currentContent = { role: 'user', parts: [{ text: (systemPrompt ? systemPrompt + '\n\n' : '') + message.content }] };
                googleContents.push(currentContent);
                systemPrompt = ''; // Reset system prompt after using it
                lastRole = 'user';
            } else if (currentContent && currentContent.role === 'user') {
                 // Append to existing user content (shouldn't happen with alternating logic?)
                 // console.warn('Appending to existing user content block in Google adapter.');
                 currentContent.parts[0].text += '\n' + message.content; 
            }
        } else if (message.role === 'assistant') {
            // Use 'assistant' for internal tracking, but 'model' for Google payload
            if (lastRole !== 'assistant') { // Check against internal 'assistant' role
                currentContent = { role: 'model', parts: [{ text: message.content }] }; // Use 'model' for Google
                googleContents.push(currentContent);
                lastRole = 'assistant'; // Set internal lastRole to 'assistant'
            } else if (currentContent && currentContent.role === 'model'){
                // Append to existing assistant content (shouldn't happen with alternating logic?)
                // console.warn('Appending to existing model content block in Google adapter.');
                 currentContent.parts[0].text += '\n' + message.content;
            }
        }
    }
    
    // Basic safety check
    if (googleContents.length === 0 || googleContents[googleContents.length - 1].role !== 'user') {
      console.error('Google Gemini request format error: History must end with a user message.', googleContents);
      throw new Error('Cannot send request to Google Gemini: message history format invalid.');
    }

    const googlePayload: {
      contents: GoogleContent[];
      generationConfig?: { // Define generationConfig as optional
        temperature?: number;
        maxOutputTokens?: number;
        // Add other Google generation config params as needed
      };
    } = {
      contents: googleContents,
    };

    // Add generationConfig if max_tokens_to_generate is provided
    if (request.max_tokens_to_generate && request.max_tokens_to_generate > 0) {
      googlePayload.generationConfig = {
        ...(googlePayload.generationConfig || {}), // Preserve other potential generationConfig settings
        maxOutputTokens: request.max_tokens_to_generate,
      };
    }

    console.log(`Sending request to Google Gemini model: ${modelApiName}`);
    // console.debug('Google Gemini Payload:', JSON.stringify(googlePayload));

    const response = await fetch(generateContentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(googlePayload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Google Gemini API error (${response.status}): ${errorBody}`);
      
      // Construct base message
      const baseErrorMessage = `Google Gemini API request failed: ${response.status}`;
      
      // Append parsed message if available
      let detailedMessage = '';
       try {
           const errorJson = JSON.parse(errorBody);
           if (errorJson.error?.message) {
               detailedMessage = errorJson.error.message;
           }
       } catch (e) { /* Ignore parsing error */ }

      // Combine messages cleanly, adding the detail part only if it exists
      const finalErrorMessage = detailedMessage 
          ? `${baseErrorMessage} - ${detailedMessage}` 
          : baseErrorMessage;

      throw new Error(finalErrorMessage);
    }

    const jsonResponse = await response.json();
    // console.debug('Google Gemini Response:', JSON.stringify(jsonResponse));

    // Extract content - needs careful checking for blocked prompts / safety ratings
    const candidate = jsonResponse.candidates?.[0];
    let assistantMessageContent = '';
    if (candidate?.finishReason === 'STOP' && candidate.content?.parts?.[0]?.text) {
        assistantMessageContent = candidate.content.parts[0].text.trim();
    } else if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
        // Handle other finish reasons (MAX_TOKENS, SAFETY, RECITATION, OTHER)
        console.warn(`Google Gemini response finished with reason: ${candidate.finishReason}`);
        // Potentially return a specific message or throw error based on reason
        assistantMessageContent = `[Response stopped due to: ${candidate.finishReason}]`; 
    } else {
        console.error("Google Gemini response missing valid content or finish reason:", jsonResponse);
        // Consider checking promptFeedback for block reasons
        const blockReason = jsonResponse.promptFeedback?.blockReason;
        if (blockReason) {
             throw new Error(`Request blocked by Google Gemini due to: ${blockReason}`);
        }
        throw new Error("Received invalid or empty response from Google Gemini.");
    }

    // --- Token Usage ---
    // Google Gemini API (generateContent) typically doesn't return token count directly in the main response.
    // You often need to make a separate call to countTokens.
    // For simplicity here, we'll omit token usage, but it could be added with another API call.
    // const tokenUsage: Json | null = null;
    // console.warn("Google Gemini adapter currently does not fetch token usage.");

    let promptTokens: number | null = null;
    let completionTokens: number | null = null;

    try {
      promptTokens = await this._countTokens(modelApiName, apiKey, googlePayload.contents);
      if (assistantMessageContent) {
        const completionContents: GoogleContent[] = [{ role: 'model', parts: [{ text: assistantMessageContent }] }];
        completionTokens = await this._countTokens(modelApiName, apiKey, completionContents);
      }
    } catch (tokenError) {
      // Log error but don't let token counting failure break the main response
      console.error("Error during token counting calls:", tokenError);
    }
    
    const tokenUsage: Json | null = (promptTokens !== null || completionTokens !== null) 
      ? {
          prompt_tokens: promptTokens || 0,
          completion_tokens: completionTokens || 0,
          total_tokens: (promptTokens || 0) + (completionTokens || 0),
        }
      : null;

    // Construct the response conforming to AdapterResponsePayload
    const assistantResponse: AdapterResponsePayload = {
      role: 'assistant',
      content: assistantMessageContent,
      ai_provider_id: request.providerId,
      system_prompt_id: request.promptId !== '__none__' ? request.promptId : null,
      token_usage: tokenUsage, 
      // REMOVED fields not provided by adapter: id, chat_id, created_at, user_id
    };

    return assistantResponse;
  }

  async listModels(apiKey: string): Promise<ProviderModelInfo[]> {
    const modelsUrl = `${GOOGLE_API_BASE}/models?key=${apiKey}`;
    console.log("Fetching models from Google Gemini...");

    const response = await fetch(modelsUrl, {
      method: 'GET',
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Google Gemini API error fetching models (${response.status}): ${errorBody}`);
      throw new Error(`Google Gemini API request failed fetching models: ${response.status} ${response.statusText}`);
    }

    const jsonResponse = await response.json();
    // console.debug('Google Models Response:', JSON.stringify(jsonResponse));

    // Check if jsonResponse.models is an array
    if (!Array.isArray(jsonResponse.models)) {
      console.error('Google Gemini API response for models is not an array:', jsonResponse);
      throw new Error('Invalid response format from Google Gemini API when fetching models.');
    }

    return jsonResponse.models
      .filter((model: GoogleModelItem) => 
        model.supportedGenerationMethods?.includes('generateContent')
      )
      .map((model: GoogleModelItem) => {
      const modelIdPart = model.name?.split('/').pop() || model.name;
      
      let rawConfigForProviderModelInfo: { provider_max_input_tokens?: number; provider_max_output_tokens?: number } | undefined = undefined;

      if (typeof model.inputTokenLimit === 'number' || typeof model.outputTokenLimit === 'number') {
        rawConfigForProviderModelInfo = {}; // Initialize if at least one limit is present
        if (typeof model.inputTokenLimit === 'number') {
          rawConfigForProviderModelInfo.provider_max_input_tokens = model.inputTokenLimit;
        }
        if (typeof model.outputTokenLimit === 'number') {
          rawConfigForProviderModelInfo.provider_max_output_tokens = model.outputTokenLimit;
        }
      }

      return {
        api_identifier: `google-${modelIdPart}`,
        name: model.displayName || model.name || 'Unknown Google Model',
        description: model.description,
        config: rawConfigForProviderModelInfo ? rawConfigForProviderModelInfo as Json : undefined,
      };
    });
  }
}

// Export an instance or the class itself
export const googleAdapter = new GoogleAdapter(); 