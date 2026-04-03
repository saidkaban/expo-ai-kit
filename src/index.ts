import ExpoAiKitModule from './ExpoAiKitModule';
import { Platform } from 'react-native';
import {
  LLMMessage,
  LLMSendOptions,
  LLMResponse,
  LLMStreamOptions,
  LLMStreamEvent,
  LLMStreamCallback,
  LLMSummarizeOptions,
  LLMTranslateOptions,
  LLMRewriteOptions,
  LLMExtractKeyPointsOptions,
  LLMAnswerQuestionOptions,
  LLMSuggestOptions,
  LLMSuggestResponse,
  LLMSmartReplyOptions,
  LLMAutocompleteOptions,
  BuiltInModel,
  DownloadableModel,
  ModelError,
} from './types';
import { MODEL_REGISTRY, getRegistryEntry } from './models';

export * from './types';
export * from './memory';
export * from './hooks';
export * from './models';

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful, friendly assistant. Answer the user directly and concisely.';

let streamIdCounter = 0;
function generateSessionId(): string {
  return `stream_${Date.now()}_${++streamIdCounter}`;
}

// ============================================================================
// Prompt Helper Constants
// ============================================================================

const SUMMARIZE_LENGTH_INSTRUCTIONS = {
  short: 'Keep it very brief, around 1-2 sentences.',
  medium: 'Provide a moderate summary, around 3-5 sentences.',
  long: 'Provide a comprehensive summary covering all main points.',
} as const;

const SUMMARIZE_STYLE_INSTRUCTIONS = {
  paragraph: 'Write the summary as a flowing paragraph.',
  bullets: 'Format the summary as bullet points.',
  tldr: 'Start with "TL;DR:" and give an extremely concise summary in 1 sentence.',
} as const;

const TRANSLATE_TONE_INSTRUCTIONS = {
  formal: 'Use formal language and honorifics where appropriate.',
  informal: 'Use casual, everyday language.',
  neutral: 'Use standard, neutral language.',
} as const;

const REWRITE_STYLE_INSTRUCTIONS = {
  formal:
    'Rewrite in a formal, professional tone suitable for business communication.',
  casual: 'Rewrite in a casual, conversational tone.',
  professional:
    'Rewrite in a clear, professional tone suitable for work contexts.',
  friendly: 'Rewrite in a warm, friendly tone.',
  concise:
    'Rewrite to be as brief as possible while keeping the meaning intact.',
  detailed: 'Expand and add more detail and explanation.',
  simple:
    'Rewrite using simple words and short sentences, easy for anyone to understand.',
  academic: 'Rewrite in an academic style suitable for scholarly writing.',
} as const;

const SUGGEST_TONE_INSTRUCTIONS = {
  formal: 'Use formal, professional language.',
  casual: 'Use casual, everyday language.',
  professional: 'Use clear, professional language suitable for work.',
  friendly: 'Use warm, friendly language.',
  neutral: 'Use standard, neutral language.',
} as const;

const ANSWER_DETAIL_INSTRUCTIONS = {
  brief: 'Give a brief, direct answer in 1-2 sentences.',
  medium: 'Provide a clear answer with some explanation.',
  detailed:
    'Provide a comprehensive answer with full explanation and relevant details from the context.',
} as const;

// ============================================================================
// Prompt Builder Helpers
// ============================================================================

function buildSummarizePrompt(
  length: 'short' | 'medium' | 'long',
  style: 'paragraph' | 'bullets' | 'tldr'
): string {
  return `You are a summarization assistant. Summarize the provided text accurately and concisely. ${SUMMARIZE_LENGTH_INSTRUCTIONS[length]} ${SUMMARIZE_STYLE_INSTRUCTIONS[style]} Only output the summary, nothing else.`;
}

function buildTranslatePrompt(
  to: string,
  from: string | undefined,
  tone: 'formal' | 'informal' | 'neutral'
): string {
  const fromClause = from ? `from ${from} ` : '';
  return `You are a translation assistant. Translate the provided text ${fromClause}to ${to}. ${TRANSLATE_TONE_INSTRUCTIONS[tone]} Only output the translation, nothing else. Do not include any explanations or notes.`;
}

function buildRewritePrompt(
  style:
    | 'formal'
    | 'casual'
    | 'professional'
    | 'friendly'
    | 'concise'
    | 'detailed'
    | 'simple'
    | 'academic'
): string {
  return `You are a writing assistant. ${REWRITE_STYLE_INSTRUCTIONS[style]} Preserve the original meaning. Only output the rewritten text, nothing else.`;
}

function buildExtractKeyPointsPrompt(maxPoints: number): string {
  return `You are an analysis assistant. Extract the ${maxPoints} most important key points from the provided text. Format each point as a bullet point starting with "•". Be concise and focus on the most significant information. Only output the bullet points, nothing else.`;
}

function buildSuggestPrompt(
  count: number,
  tone: 'formal' | 'casual' | 'professional' | 'friendly' | 'neutral',
  context?: string
): string {
  const contextClause = context
    ? ` The user is writing in this context: "${context}".`
    : '';
  return `You are a text suggestion assistant. Given the user's partial text, generate exactly ${count} possible continuations or completions.${contextClause} ${SUGGEST_TONE_INSTRUCTIONS[tone]} Output ONLY the suggestions, one per line, numbered like "1. suggestion here". Do not include any other text or explanation.`;
}

function buildSmartReplyPrompt(
  count: number,
  tone: 'formal' | 'casual' | 'professional' | 'friendly' | 'neutral',
  persona?: string
): string {
  const personaClause = persona ? ` You are replying as: ${persona}.` : '';
  return `You are a smart reply assistant. Given a conversation, generate exactly ${count} short, contextually appropriate reply suggestions that the user could send as their next message.${personaClause} ${SUGGEST_TONE_INSTRUCTIONS[tone]} Each reply should be a complete, ready-to-send message. Output ONLY the replies, one per line, numbered like "1. reply here". Do not include any other text or explanation.`;
}

function buildAutocompletePrompt(
  count: number,
  maxWords: number,
  context?: string
): string {
  const contextClause = context
    ? ` The user is writing about: "${context}".`
    : '';
  return `You are an autocomplete assistant. Given the user's partial text, generate exactly ${count} natural completions of the current sentence or phrase. Each completion should be at most ${maxWords} words and should seamlessly continue from the user's text.${contextClause} Output ONLY the completions, one per line, numbered like "1. completion here". Do not repeat the user's text. Do not include any other text or explanation.`;
}

function parseSuggestions(raw: string): { text: string }[] {
  return raw
    .split('\n')
    .map((line) => line.replace(/^\d+[\.\)]\s*/, '').trim())
    .filter((line) => line.length > 0)
    .map((text) => ({ text }));
}

function buildAnswerQuestionPrompt(
  detail: 'brief' | 'medium' | 'detailed'
): string {
  return `You are a question-answering assistant. Answer questions based ONLY on the provided context. ${ANSWER_DETAIL_INSTRUCTIONS[detail]} If the answer cannot be found in the context, say so. Do not make up information.`;
}

/**
 * Check if on-device AI is available on the current device.
 * Returns false on unsupported platforms (web, etc.).
 */
export async function isAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return false;
  }
  return ExpoAiKitModule.isAvailable();
}

/**
 * Send messages to the on-device LLM and get a response.
 *
 * @param messages - Array of messages representing the conversation
 * @param options - Optional settings (systemPrompt fallback)
 * @returns Promise with the generated response
 *
 * @example
 * ```ts
 * const response = await sendMessage([
 *   { role: 'user', content: 'What is 2 + 2?' }
 * ]);
 * console.log(response.text); // "4"
 * ```
 *
 * @example
 * ```ts
 * // With system prompt
 * const response = await sendMessage(
 *   [{ role: 'user', content: 'Hello!' }],
 *   { systemPrompt: 'You are a pirate. Respond in pirate speak.' }
 * );
 * ```
 *
 * @example
 * ```ts
 * // Multi-turn conversation
 * const response = await sendMessage([
 *   { role: 'system', content: 'You are a helpful assistant.' },
 *   { role: 'user', content: 'My name is Alice.' },
 *   { role: 'assistant', content: 'Nice to meet you, Alice!' },
 *   { role: 'user', content: 'What is my name?' }
 * ]);
 * ```
 */
export async function sendMessage(
  messages: LLMMessage[],
  options?: LLMSendOptions
): Promise<LLMResponse> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { text: '' };
  }

  if (!messages || messages.length === 0) {
    throw new Error('messages array cannot be empty');
  }

  // Determine system prompt: use from messages array if present, else options, else default
  const hasSystemMessage = messages.some((m) => m.role === 'system');
  const systemPrompt = hasSystemMessage
    ? '' // Native will extract from messages
    : options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  return ExpoAiKitModule.sendMessage(messages, systemPrompt);
}

/**
 * Stream messages to the on-device LLM and receive progressive token updates.
 *
 * @param messages - Array of messages representing the conversation
 * @param onToken - Callback function called for each token/chunk received
 * @param options - Optional settings (systemPrompt fallback)
 * @returns Object with stop() function to cancel streaming and promise that resolves when complete
 *
 * @example
 * ```ts
 * // Basic streaming
 * const { promise } = streamMessage(
 *   [{ role: 'user', content: 'Tell me a story' }],
 *   (event) => {
 *     console.log(event.token); // Each token as it arrives
 *     console.log(event.accumulatedText); // Full text so far
 *   }
 * );
 * await promise;
 * ```
 *
 * @example
 * ```ts
 * // With cancellation
 * const { promise, stop } = streamMessage(
 *   [{ role: 'user', content: 'Write a long essay' }],
 *   (event) => setText(event.accumulatedText)
 * );
 *
 * // Cancel after 5 seconds
 * setTimeout(() => stop(), 5000);
 * ```
 *
 * @example
 * ```ts
 * // React state update pattern
 * const [text, setText] = useState('');
 *
 * streamMessage(
 *   [{ role: 'user', content: 'Hello!' }],
 *   (event) => setText(event.accumulatedText)
 * );
 * ```
 */
export function streamMessage(
  messages: LLMMessage[],
  onToken: LLMStreamCallback,
  options?: LLMStreamOptions
): { promise: Promise<LLMResponse>; stop: () => void } {
  // Handle unsupported platforms
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return {
      promise: Promise.resolve({ text: '' }),
      stop: () => {},
    };
  }

  if (!messages || messages.length === 0) {
    return {
      promise: Promise.reject(new Error('messages array cannot be empty')),
      stop: () => {},
    };
  }

  const sessionId = generateSessionId();
  let finalText = '';
  let stopped = false;

  // Determine system prompt: use from messages array if present, else options, else default
  const hasSystemMessage = messages.some((m) => m.role === 'system');
  const systemPrompt = hasSystemMessage
    ? '' // Native will extract from messages
    : options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  const promise = new Promise<LLMResponse>((resolve, reject) => {
    // Subscribe to stream events
    const subscription = ExpoAiKitModule.addListener(
      'onStreamToken',
      (event: LLMStreamEvent) => {
        // Only process events for this session
        if (event.sessionId !== sessionId) return;

        finalText = event.accumulatedText;

        // Call the user's callback
        onToken(event);

        // If done, clean up and resolve
        if (event.isDone) {
          subscription.remove();
          resolve({ text: finalText });
        }
      }
    );

    // Start streaming on native side
    ExpoAiKitModule.startStreaming(messages, systemPrompt, sessionId).catch(
      (error) => {
        subscription.remove();
        reject(error);
      }
    );
  });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    ExpoAiKitModule.stopStreaming(sessionId).catch(() => {
      // Ignore errors when stopping
    });
  };

  return { promise, stop };
}

// ============================================================================
// Prompt Helpers
// ============================================================================

/**
 * Summarize text content using on-device AI.
 *
 * @param text - The text to summarize
 * @param options - Optional settings for summary style and length
 * @returns Promise with the generated summary
 *
 * @example
 * ```ts
 * // Basic summarization
 * const result = await summarize(longArticle);
 * console.log(result.text);
 * ```
 *
 * @example
 * ```ts
 * // Short bullet-point summary
 * const result = await summarize(longArticle, {
 *   length: 'short',
 *   style: 'bullets'
 * });
 * ```
 *
 * @example
 * ```ts
 * // TL;DR style
 * const result = await summarize(longArticle, {
 *   style: 'tldr'
 * });
 * ```
 */
export async function summarize(
  text: string,
  options?: LLMSummarizeOptions
): Promise<LLMResponse> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { text: '' };
  }

  if (!text || text.trim().length === 0) {
    throw new Error('text cannot be empty');
  }

  const length = options?.length ?? 'medium';
  const style = options?.style ?? 'paragraph';
  const systemPrompt = buildSummarizePrompt(length, style);

  return sendMessage([{ role: 'user', content: text }], { systemPrompt });
}

/**
 * Summarize text with streaming output.
 *
 * @param text - The text to summarize
 * @param onToken - Callback for each token received
 * @param options - Optional settings for summary style and length
 * @returns Object with stop() function and promise
 *
 * @example
 * ```ts
 * const { promise } = streamSummarize(
 *   longArticle,
 *   (event) => setSummary(event.accumulatedText),
 *   { style: 'bullets' }
 * );
 * await promise;
 * ```
 */
export function streamSummarize(
  text: string,
  onToken: LLMStreamCallback,
  options?: LLMSummarizeOptions
): { promise: Promise<LLMResponse>; stop: () => void } {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { promise: Promise.resolve({ text: '' }), stop: () => {} };
  }

  if (!text || text.trim().length === 0) {
    return {
      promise: Promise.reject(new Error('text cannot be empty')),
      stop: () => {},
    };
  }

  const length = options?.length ?? 'medium';
  const style = options?.style ?? 'paragraph';
  const systemPrompt = buildSummarizePrompt(length, style);

  return streamMessage([{ role: 'user', content: text }], onToken, {
    systemPrompt,
  });
}

/**
 * Translate text to another language using on-device AI.
 *
 * @param text - The text to translate
 * @param options - Translation options including target language
 * @returns Promise with the translated text
 *
 * @example
 * ```ts
 * // Basic translation
 * const result = await translate('Hello, world!', { to: 'Spanish' });
 * console.log(result.text); // "¡Hola, mundo!"
 * ```
 *
 * @example
 * ```ts
 * // Formal translation with source language
 * const result = await translate('Hey, what\'s up?', {
 *   to: 'French',
 *   from: 'English',
 *   tone: 'formal'
 * });
 * ```
 */
export async function translate(
  text: string,
  options: LLMTranslateOptions
): Promise<LLMResponse> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { text: '' };
  }

  if (!text || text.trim().length === 0) {
    throw new Error('text cannot be empty');
  }

  const { to, from, tone = 'neutral' } = options;
  const systemPrompt = buildTranslatePrompt(to, from, tone);

  return sendMessage([{ role: 'user', content: text }], { systemPrompt });
}

/**
 * Translate text with streaming output.
 *
 * @param text - The text to translate
 * @param onToken - Callback for each token received
 * @param options - Translation options including target language
 * @returns Object with stop() function and promise
 *
 * @example
 * ```ts
 * const { promise } = streamTranslate(
 *   'Hello, world!',
 *   (event) => setTranslation(event.accumulatedText),
 *   { to: 'Japanese' }
 * );
 * await promise;
 * ```
 */
export function streamTranslate(
  text: string,
  onToken: LLMStreamCallback,
  options: LLMTranslateOptions
): { promise: Promise<LLMResponse>; stop: () => void } {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { promise: Promise.resolve({ text: '' }), stop: () => {} };
  }

  if (!text || text.trim().length === 0) {
    return {
      promise: Promise.reject(new Error('text cannot be empty')),
      stop: () => {},
    };
  }

  const { to, from, tone = 'neutral' } = options;
  const systemPrompt = buildTranslatePrompt(to, from, tone);

  return streamMessage([{ role: 'user', content: text }], onToken, {
    systemPrompt,
  });
}

/**
 * Rewrite text in a different style using on-device AI.
 *
 * @param text - The text to rewrite
 * @param options - Rewrite options specifying the target style
 * @returns Promise with the rewritten text
 *
 * @example
 * ```ts
 * // Make text more formal
 * const result = await rewrite('hey can u help me out?', {
 *   style: 'formal'
 * });
 * console.log(result.text); // "Would you be able to assist me?"
 * ```
 *
 * @example
 * ```ts
 * // Simplify complex text
 * const result = await rewrite(technicalText, { style: 'simple' });
 * ```
 */
export async function rewrite(
  text: string,
  options: LLMRewriteOptions
): Promise<LLMResponse> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { text: '' };
  }

  if (!text || text.trim().length === 0) {
    throw new Error('text cannot be empty');
  }

  const { style } = options;
  const systemPrompt = buildRewritePrompt(style);

  return sendMessage([{ role: 'user', content: text }], { systemPrompt });
}

/**
 * Rewrite text with streaming output.
 *
 * @param text - The text to rewrite
 * @param onToken - Callback for each token received
 * @param options - Rewrite options specifying the target style
 * @returns Object with stop() function and promise
 *
 * @example
 * ```ts
 * const { promise } = streamRewrite(
 *   'hey whats up',
 *   (event) => setRewritten(event.accumulatedText),
 *   { style: 'professional' }
 * );
 * await promise;
 * ```
 */
export function streamRewrite(
  text: string,
  onToken: LLMStreamCallback,
  options: LLMRewriteOptions
): { promise: Promise<LLMResponse>; stop: () => void } {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { promise: Promise.resolve({ text: '' }), stop: () => {} };
  }

  if (!text || text.trim().length === 0) {
    return {
      promise: Promise.reject(new Error('text cannot be empty')),
      stop: () => {},
    };
  }

  const { style } = options;
  const systemPrompt = buildRewritePrompt(style);

  return streamMessage([{ role: 'user', content: text }], onToken, {
    systemPrompt,
  });
}

/**
 * Extract key points from text using on-device AI.
 *
 * @param text - The text to extract key points from
 * @param options - Optional settings for extraction
 * @returns Promise with the key points as text
 *
 * @example
 * ```ts
 * // Extract key points from an article
 * const result = await extractKeyPoints(article);
 * console.log(result.text);
 * // "• Point 1\n• Point 2\n• Point 3"
 * ```
 *
 * @example
 * ```ts
 * // Limit to 3 key points
 * const result = await extractKeyPoints(article, { maxPoints: 3 });
 * ```
 */
export async function extractKeyPoints(
  text: string,
  options?: LLMExtractKeyPointsOptions
): Promise<LLMResponse> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { text: '' };
  }

  if (!text || text.trim().length === 0) {
    throw new Error('text cannot be empty');
  }

  const maxPoints = options?.maxPoints ?? 5;
  const systemPrompt = buildExtractKeyPointsPrompt(maxPoints);

  return sendMessage([{ role: 'user', content: text }], { systemPrompt });
}

/**
 * Extract key points with streaming output.
 *
 * @param text - The text to extract key points from
 * @param onToken - Callback for each token received
 * @param options - Optional settings for extraction
 * @returns Object with stop() function and promise
 *
 * @example
 * ```ts
 * const { promise } = streamExtractKeyPoints(
 *   article,
 *   (event) => setKeyPoints(event.accumulatedText),
 *   { maxPoints: 5 }
 * );
 * await promise;
 * ```
 */
export function streamExtractKeyPoints(
  text: string,
  onToken: LLMStreamCallback,
  options?: LLMExtractKeyPointsOptions
): { promise: Promise<LLMResponse>; stop: () => void } {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { promise: Promise.resolve({ text: '' }), stop: () => {} };
  }

  if (!text || text.trim().length === 0) {
    return {
      promise: Promise.reject(new Error('text cannot be empty')),
      stop: () => {},
    };
  }

  const maxPoints = options?.maxPoints ?? 5;
  const systemPrompt = buildExtractKeyPointsPrompt(maxPoints);

  return streamMessage([{ role: 'user', content: text }], onToken, {
    systemPrompt,
  });
}

/**
 * Answer a question based on provided context using on-device AI.
 *
 * @param question - The question to answer
 * @param context - The context/document to base the answer on
 * @param options - Optional settings for the answer
 * @returns Promise with the answer
 *
 * @example
 * ```ts
 * // Answer a question about a document
 * const result = await answerQuestion(
 *   'What is the main topic?',
 *   documentText
 * );
 * console.log(result.text);
 * ```
 *
 * @example
 * ```ts
 * // Get a detailed answer
 * const result = await answerQuestion(
 *   'Explain the methodology',
 *   researchPaper,
 *   { detail: 'detailed' }
 * );
 * ```
 */
export async function answerQuestion(
  question: string,
  context: string,
  options?: LLMAnswerQuestionOptions
): Promise<LLMResponse> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { text: '' };
  }

  if (!question || question.trim().length === 0) {
    throw new Error('question cannot be empty');
  }

  if (!context || context.trim().length === 0) {
    throw new Error('context cannot be empty');
  }

  const detail = options?.detail ?? 'medium';
  const systemPrompt = buildAnswerQuestionPrompt(detail);
  const userContent = `Context:\n${context}\n\nQuestion: ${question}`;

  return sendMessage([{ role: 'user', content: userContent }], { systemPrompt });
}

/**
 * Answer a question with streaming output.
 *
 * @param question - The question to answer
 * @param context - The context/document to base the answer on
 * @param onToken - Callback for each token received
 * @param options - Optional settings for the answer
 * @returns Object with stop() function and promise
 *
 * @example
 * ```ts
 * const { promise } = streamAnswerQuestion(
 *   'What are the key findings?',
 *   documentText,
 *   (event) => setAnswer(event.accumulatedText),
 *   { detail: 'detailed' }
 * );
 * await promise;
 * ```
 */
export function streamAnswerQuestion(
  question: string,
  context: string,
  onToken: LLMStreamCallback,
  options?: LLMAnswerQuestionOptions
): { promise: Promise<LLMResponse>; stop: () => void } {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { promise: Promise.resolve({ text: '' }), stop: () => {} };
  }

  if (!question || question.trim().length === 0) {
    return {
      promise: Promise.reject(new Error('question cannot be empty')),
      stop: () => {},
    };
  }

  if (!context || context.trim().length === 0) {
    return {
      promise: Promise.reject(new Error('context cannot be empty')),
      stop: () => {},
    };
  }

  const detail = options?.detail ?? 'medium';
  const systemPrompt = buildAnswerQuestionPrompt(detail);
  const userContent = `Context:\n${context}\n\nQuestion: ${question}`;

  return streamMessage([{ role: 'user', content: userContent }], onToken, {
    systemPrompt,
  });
}

// ============================================================================
// Smart Suggestions
// ============================================================================

/**
 * Generate text suggestions based on partial input using on-device AI.
 *
 * Useful for text completion, writing assistance, and predictive text features.
 *
 * @param partialText - The text the user has typed so far
 * @param options - Optional settings for suggestions
 * @returns Promise with an array of suggestions
 *
 * @example
 * ```ts
 * // Basic suggestions
 * const result = await suggest('I think we should');
 * result.suggestions.forEach(s => console.log(s.text));
 * // "schedule a meeting to discuss this further"
 * // "consider an alternative approach"
 * // "move forward with the plan"
 * ```
 *
 * @example
 * ```ts
 * // With context and tone
 * const result = await suggest('Dear Mr. Johnson,', {
 *   count: 5,
 *   context: 'writing a business email about project delays',
 *   tone: 'formal'
 * });
 * ```
 */
export async function suggest(
  partialText: string,
  options?: LLMSuggestOptions
): Promise<LLMSuggestResponse> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { suggestions: [], raw: '' };
  }

  if (!partialText || partialText.trim().length === 0) {
    throw new Error('partialText cannot be empty');
  }

  const count = options?.count ?? 3;
  const tone = options?.tone ?? 'neutral';
  const systemPrompt = buildSuggestPrompt(count, tone, options?.context);

  const response = await sendMessage(
    [{ role: 'user', content: partialText }],
    { systemPrompt }
  );

  return {
    suggestions: parseSuggestions(response.text),
    raw: response.text,
  };
}

/**
 * Generate text suggestions with streaming output.
 *
 * @param partialText - The text the user has typed so far
 * @param onToken - Callback for each token received
 * @param options - Optional settings for suggestions
 * @returns Object with stop() function and promise
 *
 * @example
 * ```ts
 * const { promise } = streamSuggest(
 *   'The best way to',
 *   (event) => setRawSuggestions(event.accumulatedText)
 * );
 * const result = await promise;
 * // Parse suggestions from result.text
 * ```
 */
export function streamSuggest(
  partialText: string,
  onToken: LLMStreamCallback,
  options?: LLMSuggestOptions
): { promise: Promise<LLMResponse>; stop: () => void } {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { promise: Promise.resolve({ text: '' }), stop: () => {} };
  }

  if (!partialText || partialText.trim().length === 0) {
    return {
      promise: Promise.reject(new Error('partialText cannot be empty')),
      stop: () => {},
    };
  }

  const count = options?.count ?? 3;
  const tone = options?.tone ?? 'neutral';
  const systemPrompt = buildSuggestPrompt(count, tone, options?.context);

  return streamMessage([{ role: 'user', content: partialText }], onToken, {
    systemPrompt,
  });
}

/**
 * Generate smart reply suggestions for a conversation using on-device AI.
 *
 * Analyzes the conversation history and generates contextually appropriate
 * reply options, similar to Gmail/Messages smart replies.
 *
 * @param messages - The conversation history to generate replies for
 * @param options - Optional settings for reply generation
 * @returns Promise with an array of reply suggestions
 *
 * @example
 * ```ts
 * // Basic smart replies
 * const result = await smartReply([
 *   { role: 'user', content: 'Hey, are you free for lunch tomorrow?' }
 * ]);
 * result.suggestions.forEach(s => console.log(s.text));
 * // "Sure, what time works for you?"
 * // "Sorry, I already have plans."
 * // "Let me check my schedule and get back to you."
 * ```
 *
 * @example
 * ```ts
 * // With persona and tone
 * const result = await smartReply(
 *   [
 *     { role: 'user', content: 'We need the report by Friday.' },
 *     { role: 'assistant', content: 'I will do my best.' },
 *     { role: 'user', content: 'Can you confirm the deadline works?' }
 *   ],
 *   { tone: 'professional', persona: 'project manager', count: 4 }
 * );
 * ```
 */
export async function smartReply(
  messages: LLMMessage[],
  options?: LLMSmartReplyOptions
): Promise<LLMSuggestResponse> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { suggestions: [], raw: '' };
  }

  if (!messages || messages.length === 0) {
    throw new Error('messages array cannot be empty');
  }

  const count = options?.count ?? 3;
  const tone = options?.tone ?? 'neutral';
  const systemPrompt = buildSmartReplyPrompt(count, tone, options?.persona);

  const conversation = messages
    .map((m) => `${m.role === 'user' ? 'Them' : 'Me'}: ${m.content}`)
    .join('\n');

  const response = await sendMessage(
    [{ role: 'user', content: `Conversation:\n${conversation}\n\nGenerate ${count} reply suggestions for my next message.` }],
    { systemPrompt }
  );

  return {
    suggestions: parseSuggestions(response.text),
    raw: response.text,
  };
}

/**
 * Generate smart reply suggestions with streaming output.
 *
 * @param messages - The conversation history to generate replies for
 * @param onToken - Callback for each token received
 * @param options - Optional settings for reply generation
 * @returns Object with stop() function and promise
 *
 * @example
 * ```ts
 * const { promise } = streamSmartReply(
 *   [{ role: 'user', content: 'Want to grab coffee?' }],
 *   (event) => setRawReplies(event.accumulatedText)
 * );
 * const result = await promise;
 * ```
 */
export function streamSmartReply(
  messages: LLMMessage[],
  onToken: LLMStreamCallback,
  options?: LLMSmartReplyOptions
): { promise: Promise<LLMResponse>; stop: () => void } {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { promise: Promise.resolve({ text: '' }), stop: () => {} };
  }

  if (!messages || messages.length === 0) {
    return {
      promise: Promise.reject(new Error('messages array cannot be empty')),
      stop: () => {},
    };
  }

  const count = options?.count ?? 3;
  const tone = options?.tone ?? 'neutral';
  const systemPrompt = buildSmartReplyPrompt(count, tone, options?.persona);

  const conversation = messages
    .map((m) => `${m.role === 'user' ? 'Them' : 'Me'}: ${m.content}`)
    .join('\n');

  return streamMessage(
    [{ role: 'user', content: `Conversation:\n${conversation}\n\nGenerate ${count} reply suggestions for my next message.` }],
    onToken,
    { systemPrompt }
  );
}

/**
 * Autocomplete the user's current text using on-device AI.
 *
 * Generates short, natural completions that seamlessly continue from
 * the user's partial input. Ideal for real-time typing suggestions.
 *
 * @param partialText - The text the user has typed so far
 * @param options - Optional settings for autocompletion
 * @returns Promise with an array of completion suggestions
 *
 * @example
 * ```ts
 * // Basic autocomplete
 * const result = await autocomplete('How do I');
 * result.suggestions.forEach(s => console.log(s.text));
 * // "reset my password"
 * // "contact support"
 * // "cancel my subscription"
 * ```
 *
 * @example
 * ```ts
 * // With context for better suggestions
 * const result = await autocomplete('The patient presents with', {
 *   context: 'medical notes',
 *   maxWords: 15,
 *   count: 5
 * });
 * ```
 */
export async function autocomplete(
  partialText: string,
  options?: LLMAutocompleteOptions
): Promise<LLMSuggestResponse> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { suggestions: [], raw: '' };
  }

  if (!partialText || partialText.trim().length === 0) {
    throw new Error('partialText cannot be empty');
  }

  const count = options?.count ?? 3;
  const maxWords = options?.maxWords ?? 10;
  const systemPrompt = buildAutocompletePrompt(count, maxWords, options?.context);

  const response = await sendMessage(
    [{ role: 'user', content: partialText }],
    { systemPrompt }
  );

  return {
    suggestions: parseSuggestions(response.text),
    raw: response.text,
  };
}

/**
 * Autocomplete text with streaming output.
 *
 * @param partialText - The text the user has typed so far
 * @param onToken - Callback for each token received
 * @param options - Optional settings for autocompletion
 * @returns Object with stop() function and promise
 *
 * @example
 * ```ts
 * const { promise } = streamAutocomplete(
 *   'I would like to',
 *   (event) => setRawCompletions(event.accumulatedText)
 * );
 * const result = await promise;
 * ```
 */
export function streamAutocomplete(
  partialText: string,
  onToken: LLMStreamCallback,
  options?: LLMAutocompleteOptions
): { promise: Promise<LLMResponse>; stop: () => void } {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { promise: Promise.resolve({ text: '' }), stop: () => {} };
  }

  if (!partialText || partialText.trim().length === 0) {
    return {
      promise: Promise.reject(new Error('partialText cannot be empty')),
      stop: () => {},
    };
  }

  const count = options?.count ?? 3;
  const maxWords = options?.maxWords ?? 10;
  const systemPrompt = buildAutocompletePrompt(count, maxWords, options?.context);

  return streamMessage([{ role: 'user', content: partialText }], onToken, {
    systemPrompt,
  });
}

/**
 * Parse suggestion text from a suggest/smartReply/autocomplete response.
 *
 * Use this to parse the raw text from streaming responses into structured suggestions.
 *
 * @param raw - Raw text response from the model
 * @returns Array of parsed suggestions
 *
 * @example
 * ```ts
 * const { promise } = streamSuggest('Hello', (event) => {
 *   setText(event.accumulatedText);
 * });
 * const result = await promise;
 * const suggestions = parseSuggestResponse(result.text);
 * ```
 */
export function parseSuggestResponse(raw: string): LLMSuggestResponse {
  return {
    suggestions: parseSuggestions(raw),
    raw,
  };
}

// ============================================================================
// Model Management API
// ============================================================================

/**
 * Get all built-in models available on the current platform.
 *
 * Built-in models are provided by the OS and require no download.
 * On iOS this returns Apple Foundation Models; on Android, ML Kit.
 *
 * @returns Array of built-in models with availability status
 */
export async function getBuiltInModels(): Promise<BuiltInModel[]> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return [];
  }
  return ExpoAiKitModule.getBuiltInModels();
}

/**
 * Get all downloadable models from the registry, enriched with on-device status.
 *
 * Reads from the hardcoded MODEL_REGISTRY and queries the native layer
 * for the current download/load status of each model.
 *
 * @returns Array of downloadable models with their current status
 */
export async function getDownloadableModels(): Promise<DownloadableModel[]> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return [];
  }

  const platformModels = MODEL_REGISTRY.filter((entry) =>
    entry.supportedPlatforms.includes(Platform.OS as 'ios' | 'android')
  );

  let deviceRamBytes = 0;
  try {
    deviceRamBytes = ExpoAiKitModule.getDeviceRamBytes();
  } catch {
    // Native call unavailable -- default to 0 (all models will show meetsRequirements: false)
  }

  return platformModels.map((entry) => {
    const status = ExpoAiKitModule.getDownloadableModelStatus(entry.id);
    return {
      id: entry.id,
      name: entry.name,
      parameterCount: entry.parameterCount,
      sizeBytes: entry.sizeBytes,
      contextWindow: entry.contextWindow,
      minRamBytes: entry.minRamBytes,
      meetsRequirements: deviceRamBytes >= entry.minRamBytes,
      status,
    };
  });
}

/**
 * Download a model to the device.
 *
 * Looks up the model in the registry, validates platform support and
 * device requirements, then initiates the download with integrity verification.
 *
 * @param modelId - ID of the model to download (e.g. 'gemma-e2b')
 * @param options - Optional download configuration
 * @param options.onProgress - Callback with download progress (0-1)
 * @throws {ModelError} MODEL_NOT_FOUND if modelId is not in the registry
 * @throws {ModelError} DEVICE_NOT_SUPPORTED if platform is not supported
 * @throws {ModelError} DOWNLOAD_FAILED on network error
 * @throws {ModelError} DOWNLOAD_STORAGE_FULL if insufficient disk space
 * @throws {ModelError} DOWNLOAD_CORRUPT if SHA256 hash doesn't match
 */
export async function downloadModel(
  modelId: string,
  options?: { onProgress?: (progress: number) => void }
): Promise<void> {
  const entry = getRegistryEntry(modelId);
  if (!entry) {
    throw new ModelError('MODEL_NOT_FOUND', modelId);
  }

  if (!entry.supportedPlatforms.includes(Platform.OS as 'ios' | 'android')) {
    throw new ModelError(
      'DEVICE_NOT_SUPPORTED',
      modelId,
      `Model ${modelId} is not supported on ${Platform.OS}`
    );
  }

  try {
    const deviceRamBytes = ExpoAiKitModule.getDeviceRamBytes();
    if (deviceRamBytes < entry.minRamBytes) {
      throw new ModelError(
        'DEVICE_NOT_SUPPORTED',
        modelId,
        `Device has ${Math.round(deviceRamBytes / 1e9)}GB RAM, model requires ${Math.round(entry.minRamBytes / 1e9)}GB`
      );
    }
  } catch (e) {
    if (e instanceof ModelError) throw e;
    // If getDeviceRamBytes is unavailable, skip the check
  }

  let subscription: ReturnType<typeof ExpoAiKitModule.addListener> | undefined;
  if (options?.onProgress) {
    subscription = ExpoAiKitModule.addListener(
      'onDownloadProgress',
      (event) => {
        if (event.modelId === modelId) {
          options.onProgress!(event.progress);
        }
      }
    );
  }

  try {
    await ExpoAiKitModule.downloadModel(
      modelId,
      entry.downloadUrl,
      entry.sha256
    );
  } finally {
    subscription?.remove();
  }
}

/**
 * Delete a downloaded model from the device.
 *
 * If the model is currently loaded, it will be unloaded first.
 *
 * @param modelId - ID of the model to delete
 * @throws {ModelError} MODEL_NOT_FOUND if modelId is not in the registry
 */
export async function deleteModel(modelId: string): Promise<void> {
  const entry = getRegistryEntry(modelId);
  if (!entry) {
    throw new ModelError('MODEL_NOT_FOUND', modelId);
  }

  await ExpoAiKitModule.deleteModel(modelId);
}

/**
 * Set the active model for inference.
 *
 * This is the sole gatekeeper for model validity. If setModel succeeds,
 * the model is loaded and ready -- sendMessage never needs its own check.
 *
 * For downloadable models, this loads the model into memory (status
 * transitions: loading -> ready). Only one downloadable model can be
 * loaded at a time; the previous one is auto-unloaded.
 *
 * For built-in models, this simply switches the active backend.
 *
 * If setModel was never called, sendMessage uses the platform built-in
 * model (today's behavior, no error).
 *
 * @param modelId - ID of the model to activate (e.g. 'gemma-e2b', 'apple-fm', 'mlkit')
 * @throws {ModelError} MODEL_NOT_FOUND if modelId is invalid
 * @throws {ModelError} MODEL_NOT_DOWNLOADED if the downloadable model file is not on disk
 * @throws {ModelError} MODEL_LOAD_FAILED if loading into memory fails
 * @throws {ModelError} INFERENCE_OOM if device can't fit model in memory
 */
export async function setModel(modelId: string): Promise<void> {
  await ExpoAiKitModule.setModel(modelId);
}

/**
 * Get the ID of the currently active model.
 *
 * @returns The active model ID (e.g. 'apple-fm', 'mlkit', 'gemma-e2b')
 */
export function getActiveModel(): string {
  return ExpoAiKitModule.getActiveModel();
}

/**
 * Explicitly unload the current downloadable model from memory.
 *
 * Frees memory and reverts to the platform built-in model.
 * No-op if no downloadable model is currently loaded.
 */
export async function unloadModel(): Promise<void> {
  await ExpoAiKitModule.unloadModel();
}

