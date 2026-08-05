export interface NavItem {
  title: string;
  href?: string;
  items?: NavItem[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const navigation: NavSection[] = [
  {
    title: "Introduction",
    items: [
      { title: "Overview", href: "/" },
      { title: "Get Started", href: "/get-started" },
    ],
  },
  {
    title: "Guides",
    items: [
      { title: "Vercel AI SDK", href: "/guides/vercel-ai-sdk" },
      { title: "Platform Support", href: "/guides/platform-support" },
      { title: "Multi-turn Conversations", href: "/guides/multi-turn" },
      { title: "Structured Output", href: "/guides/structured-output" },
      { title: "Tool Calling", href: "/guides/tool-calling" },
      { title: "Embeddings & RAG", href: "/guides/embeddings" },
      { title: "Models", href: "/guides/models" },
      { title: "Android Setup", href: "/guides/android-setup" },
    ],
  },
  {
    title: "API Reference",
    items: [
      { title: "isAvailable()", href: "/api#isavailable" },
      { title: "sendMessage()", href: "/api#sendmessage" },
      { title: "streamMessage()", href: "/api#streammessage" },
      { title: "generateObject()", href: "/api#generateobject" },
      { title: "generateText()", href: "/api#generatetext" },
      { title: "embed()", href: "/api#embed" },
      { title: "AI SDK Provider", href: "/api#ai-sdk-provider" },
      { title: "RAG Toolkit", href: "/api#rag-toolkit" },
      { title: "Model Management", href: "/api#model-management" },
      { title: "Custom Models", href: "/api#custom-models" },
      { title: "Types", href: "/api#types" },
      { title: "Errors", href: "/api#errors" },
    ],
  },
  {
    title: "Help",
    items: [
      { title: "Troubleshooting", href: "/troubleshooting" },
      { title: "Examples", href: "/examples" },
    ],
  },
];

export interface SearchItem {
  title: string;
  href: string;
  section: string;
  description?: string;
}

export const searchIndex: SearchItem[] = [
  {
    title: "Overview",
    href: "/",
    section: "Introduction",
    description: "On-device AI for Expo apps",
  },
  {
    title: "Get Started",
    href: "/get-started",
    section: "Introduction",
    description: "Install and configure expo-ai-kit",
  },
  {
    title: "Vercel AI SDK",
    href: "/guides/vercel-ai-sdk",
    section: "Guides",
    description:
      "Use generateText, streamText, generateObject, and embed from the AI SDK with on-device models via expo-ai-kit/ai",
  },
  {
    title: "Platform Support",
    href: "/guides/platform-support",
    section: "Guides",
    description: "iOS and Android platform requirements",
  },
  {
    title: "Multi-turn Conversations",
    href: "/guides/multi-turn",
    section: "Guides",
    description: "Build chatbots with conversation context",
  },
  {
    title: "Structured Output",
    href: "/guides/structured-output",
    section: "Guides",
    description: "Get a typed object back with generateObject() and a JSON Schema",
  },
  {
    title: "Tool Calling",
    href: "/guides/tool-calling",
    section: "Guides",
    description: "Let the model call your functions with generateText()",
  },
  {
    title: "Embeddings & RAG",
    href: "/guides/embeddings",
    section: "Guides",
    description: "Embed text and retrieve relevant chunks for on-device RAG with embed() and createVectorStore()",
  },
  {
    title: "Models",
    href: "/guides/models",
    section: "Guides",
    description: "Built-in OS models, downloadable Gemma/Qwen/Phi, and bring-your-own-model",
  },
  {
    title: "Android Setup",
    href: "/guides/android-setup",
    section: "Guides",
    description: "Configure Android with ML Kit and the opt-in embeddings backend",
  },
  {
    title: "API Reference",
    href: "/api",
    section: "API Reference",
    description: "Complete API documentation",
  },
  {
    title: "isAvailable()",
    href: "/api#isavailable",
    section: "API Reference",
    description: "Check if on-device AI is available",
  },
  {
    title: "sendMessage()",
    href: "/api#sendmessage",
    section: "API Reference",
    description: "Send messages and get an AI response",
  },
  {
    title: "streamMessage()",
    href: "/api#streammessage",
    section: "API Reference",
    description: "Stream AI responses with progressive token updates",
  },
  {
    title: "generateObject()",
    href: "/api#generateobject",
    section: "API Reference",
    description: "Get a typed object validated against a JSON Schema",
  },
  {
    title: "generateText()",
    href: "/api#generatetext",
    section: "API Reference",
    description: "Generate text with optional tool / function calling",
  },
  {
    title: "embed()",
    href: "/api#embed",
    section: "API Reference",
    description:
      "Turn text into embedding vectors for semantic search (iOS + Android opt-in)",
  },
  {
    title: "Embedding model lifecycle",
    href: "/api#embedding-lifecycle",
    section: "API Reference",
    description:
      "getEmbeddingModelStatus, prepareEmbeddingModel, cancel/delete, supported languages",
  },
  {
    title: "AI SDK Provider",
    href: "/api#ai-sdk-provider",
    section: "API Reference",
    description: "expoAiKit and createExpoAiKit — the Vercel AI SDK provider from expo-ai-kit/ai",
  },
  {
    title: "RAG Toolkit",
    href: "/api#rag-toolkit",
    section: "API Reference",
    description: "chunkText, cosineSimilarity, and createVectorStore for on-device retrieval",
  },
  {
    title: "Model Management",
    href: "/api#model-management",
    section: "API Reference",
    description: "getDownloadableModels, downloadModel, setModel, unloadModel, and more",
  },
  {
    title: "Custom Models",
    href: "/api#custom-models",
    section: "API Reference",
    description: "registerModel, unregisterModel, fetchModelMetadata",
  },
  {
    title: "Types",
    href: "/api#types",
    section: "API Reference",
    description: "LLMMessage, GenerationConfig, JSONSchema, Tool, DownloadableModel, and more",
  },
  {
    title: "Errors",
    href: "/api#errors",
    section: "API Reference",
    description: "ModelError and the ModelErrorCode union",
  },
  {
    title: "Troubleshooting",
    href: "/troubleshooting",
    section: "Help",
    description: "Common issues and solutions",
  },
  {
    title: "Examples",
    href: "/examples",
    section: "Help",
    description: "Code examples and sample applications",
  },
];
