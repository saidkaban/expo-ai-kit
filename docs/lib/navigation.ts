export interface NavItem {
  title: string;
  href: string;
  description: string;
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
      {
        title: "Overview",
        href: "/",
        description: "On-device AI for Expo and React Native",
      },
      {
        title: "Get Started",
        href: "/get-started",
        description: "Install expo-ai-kit and run your first local model",
      },
    ],
  },
  {
    title: "Guides",
    items: [
      {
        title: "Vercel AI SDK",
        href: "/guides/vercel-ai-sdk",
        description: "Use the AI SDK with on-device language and embedding models",
      },
      {
        title: "Platform Support",
        href: "/guides/platform-support",
        description: "Compare iOS and Android requirements and capabilities",
      },
      {
        title: "Multi-turn Conversations",
        href: "/guides/multi-turn",
        description: "Keep and pass conversation history between turns",
      },
      {
        title: "Structured Output",
        href: "/guides/structured-output",
        description: "Generate typed objects validated against JSON Schema",
      },
      {
        title: "Tool Calling",
        href: "/guides/tool-calling",
        description: "Let on-device models call functions in your app",
      },
      {
        title: "Embeddings & RAG",
        href: "/guides/embeddings",
        description: "Build semantic search and retrieval-augmented generation",
      },
      {
        title: "Models",
        href: "/guides/models",
        description: "Use OS models, download open models, or bring your own",
      },
      {
        title: "Android Setup",
        href: "/guides/android-setup",
        description: "Configure ML Kit and optional Android embeddings",
      },
      {
        title: "Migration",
        href: "/guides/migration",
        description: "Upgrade applications built with the early session API",
      },
    ],
  },
  {
    title: "API Reference",
    items: [
      {
        title: "isAvailable()",
        href: "/api#isavailable",
        description: "Check whether the current device supports on-device AI",
      },
      {
        title: "prepareBuiltInModel()",
        href: "/api#preparebuiltinmodel",
        description: "Prepare Android ML Kit or validate Apple Foundation Models",
      },
      {
        title: "sendMessage()",
        href: "/api#sendmessage",
        description: "Generate one response from a conversation",
      },
      {
        title: "streamMessage()",
        href: "/api#streammessage",
        description: "Stream tokens with progress and cancellation",
      },
      {
        title: "generateObject()",
        href: "/api#generateobject",
        description: "Generate and validate a typed object",
      },
      {
        title: "generateText()",
        href: "/api#generatetext",
        description: "Generate text with optional tool calling",
      },
      {
        title: "embed()",
        href: "/api#embed",
        description: "Create vectors for semantic search and RAG",
      },
      {
        title: "Embedding lifecycle",
        href: "/api#embedding-lifecycle",
        description: "Prepare and manage embedding model assets",
      },
      {
        title: "AI SDK Provider",
        href: "/api#ai-sdk-provider",
        description: "Use expo-ai-kit through the Vercel AI SDK",
      },
      {
        title: "RAG Toolkit",
        href: "/api#rag-toolkit",
        description: "Chunk text, compare vectors, and search an in-memory store",
      },
      {
        title: "Model Management",
        href: "/api#model-management",
        description: "Discover, download, activate, and remove models",
      },
      {
        title: "Custom Models",
        href: "/api#custom-models",
        description: "Register compatible custom LiteRT-LM models",
      },
      {
        title: "Types",
        href: "/api#types",
        description: "Public TypeScript types and configuration",
      },
      {
        title: "Errors",
        href: "/api#errors",
        description: "Handle typed ModelError codes",
      },
    ],
  },
  {
    title: "Help",
    items: [
      {
        title: "Troubleshooting",
        href: "/troubleshooting",
        description: "Diagnose setup, model, download, and inference failures",
      },
      {
        title: "Examples",
        href: "/examples",
        description: "Copy complete integration patterns",
      },
    ],
  },
];

export interface SearchItem {
  title: string;
  href: string;
  section: string;
  description: string;
}

function flattenItems(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...(item.items ? flattenItems(item.items) : [])]);
}

// Search and the sidebar share one source of truth. Adding a page or API entry
// to navigation makes it searchable automatically.
export const searchIndex: SearchItem[] = navigation.flatMap((section) =>
  flattenItems(section.items).map((item) => ({
    title: item.title,
    href: item.href,
    section: section.title,
    description: item.description,
  }))
);
