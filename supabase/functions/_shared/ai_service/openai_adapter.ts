import type { AiProviderAdapter, ChatMessage, ProviderModelInfo, ChatApiRequest, AdapterResponsePayload, ILogger, AiModelExtendedConfig, TiktokenEncoding } from '../types.ts';
import type { Json } from '../../../functions/types_db.ts';

const OPENAI_API_BASE = 'https://api.openai.com/v1';

// Define a type for the items in the OpenAI models list
interface OpenAIModelItem {
  id: string;
  owned_by?: string;
  context_window?: number; // Provided by OpenAI API for many models
  // Other fields from OpenAI API might exist, e.g., relating to capabilities or rate limits.
  // For now, we focus on id and context_window for config derivation.
  [key: string]: unknown;
}

/**
 * Implements AiProviderAdapter for OpenAI models.
 */
export class OpenAiAdapter implements AiProviderAdapter {

  constructor(private apiKey: string, private logger: ILogger) {}

  async sendMessage(
    request: ChatApiRequest, // Contains previous messages if chatId was provided
    modelIdentifier: string, // e.g., "openai-gpt-4o" -> "gpt-4o"
  ): Promise<AdapterResponsePayload> {
    this.logger.debug('[OpenAiAdapter] sendMessage called', { modelIdentifier });
    // Use fetch directly
    const openaiUrl = `${OPENAI_API_BASE}/chat/completions`;
    // Remove provider prefix if present (ensure this matches your DB data convention)
    const modelApiName = modelIdentifier.replace(/^openai-/i, '');

    // Map app messages to OpenAI format
    const openaiMessages = (request.messages ?? []).map(msg => ({
      role: msg.role,
      content: msg.content,
    })).filter(msg => msg.content); // Ensure no empty messages

    // Add the current user message if it exists
    if (request.message) {
      openaiMessages.push({ role: 'user', content: request.message });
    }

    const openaiPayload: { 
      model: string;
      messages: { role: string; content: string }[];
      max_tokens?: number; // Define max_tokens as optional here
      // temperature: number; // Example of other params
    } = {
      model: modelApiName,
      messages: openaiMessages,
      // Add other parameters as needed
      // temperature: 0.7,
    };

    // Add max_tokens to the payload if it's provided in the request
    if (request.max_tokens_to_generate && request.max_tokens_to_generate > 0) {
      openaiPayload.max_tokens = request.max_tokens_to_generate;
    }

    this.logger.info(`Sending fetch request to OpenAI model: ${modelApiName}`, { url: openaiUrl });

    const response = await fetch(openaiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(openaiPayload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(`OpenAI API fetch error (${response.status}): ${errorBody}`, { modelApiName, status: response.status });
      throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText}`);
    }

    const jsonResponse = await response.json();

    const choice = jsonResponse.choices?.[0];
    const aiContent = choice?.message?.content?.trim();
    
    if (!aiContent) {
      this.logger.error("OpenAI fetch response missing message content:", { response: jsonResponse, modelApiName });
      throw new Error('OpenAI response content is empty or missing.');
    }

    const finishReason = choice?.finish_reason;
    let finish_reason: AdapterResponsePayload['finish_reason'];

    switch (finishReason) {
      case 'stop':
        finish_reason = 'stop';
        break;
      case 'length':
        finish_reason = 'length';
        break;
      case 'tool_calls':
        finish_reason = 'tool_calls';
        break;
      case 'content_filter':
        finish_reason = 'content_filter';
        break;
      case 'function_call':
        finish_reason = 'function_call';
        break;
      default:
        finish_reason = 'unknown';
        if (finishReason) { // Log if we get a new, unexpected reason
            this.logger.warn(`OpenAI returned an unknown finish reason: ${finishReason}`, { modelApiName, finishReason });
        }
        break;
    }
    
    const tokenUsage = jsonResponse.usage ? {
      prompt_tokens: jsonResponse.usage.prompt_tokens,
      completion_tokens: jsonResponse.usage.completion_tokens,
      total_tokens: jsonResponse.usage.total_tokens,
    } : null;

    // Construct the response conforming to AdapterResponsePayload
    const assistantResponse: AdapterResponsePayload = {
      role: 'assistant',
      content: aiContent,
      ai_provider_id: request.providerId, // Pass through the provider DB ID
      system_prompt_id: request.promptId !== '__none__' ? request.promptId : null, // Pass through prompt DB ID
      token_usage: tokenUsage,
      finish_reason: finish_reason,
      // REMOVED fields not provided by adapter: id, chat_id, created_at, user_id
    };
    this.logger.debug('[OpenAiAdapter] sendMessage successful', { modelApiName });
    return assistantResponse;
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    const modelsUrl = `${OPENAI_API_BASE}/models`;
    this.logger.info("[OpenAiAdapter] Fetching models from OpenAI...", { url: modelsUrl });

    this.logger.debug("[OpenAiAdapter] Before fetch call");
    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });
    this.logger.debug(`[OpenAiAdapter] After fetch call (Status: ${response.status})`);

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(`[OpenAiAdapter] OpenAI API error fetching models (${response.status}): ${errorBody}`, { status: response.status });
      throw new Error(`OpenAI API request failed fetching models: ${response.status} ${response.statusText}`);
    }

    this.logger.debug("[OpenAiAdapter] Before response.json() call");
    const jsonResponse = await response.json();
    this.logger.debug("[OpenAiAdapter] After response.json() call");
    const models: ProviderModelInfo[] = [];

    if (jsonResponse.data && Array.isArray(jsonResponse.data)) {
      jsonResponse.data.forEach((model: OpenAIModelItem) => {
        // Filter for models we are interested in (e.g., GPT series)
        if (model.id && (model.id.includes('gpt') || model.id.includes('instruct'))) {
            const config: Partial<AiModelExtendedConfig> = {};

            // Set context window and provider max input tokens from API if available
            if (model.context_window) {
                config.context_window_tokens = model.context_window;
                config.provider_max_input_tokens = model.context_window;
            }

            // Tokenization strategy is NOT set by the adapter from OpenAI /models endpoint,
            // as OpenAI does not provide these specific details (encoding name, chatml status) directly here.
            // These will be handled by defaults in createDefaultOpenAIConfig and merged.
            // config.tokenization_strategy = { ... }; // REMOVED
            
            // provider_max_output_tokens is not set here as it's not reliably in /models list.

            models.push({
                api_identifier: `openai-${model.id}`,
                name: `OpenAI ${model.id}`,
                description: `Owned by: ${model.owned_by}`,
                // Only include config if it has properties (e.g. context_window_tokens was set)
                config: Object.keys(config).length > 0 ? config as Json : undefined,
            });
        }
      });
    }

    this.logger.info(`[OpenAiAdapter] Found ${models.length} potentially usable models from OpenAI.`);
    return models;
  }
}

// Removed: export const openAiAdapter = new OpenAiAdapter(); 
// The class OpenAiAdapter is now exported directly and will be instantiated by the factory. 