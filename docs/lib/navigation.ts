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

// The sidebar mirrors the library's capabilities (Text, Speech, Vision,
// Embeddings today), followed by the cross-cutting model, platform, and
// integration guides. A new capability gets its own group here.
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
    title: "Text",
    items: [
      {
        title: "Text Generation",
        href: "/guides/text-generation",
        description: "Generate and stream text with the on-device model",
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
    ],
  },
  {
    title: "Speech",
    items: [
      {
        title: "Speech-to-Text",
        href: "/guides/speech",
        description: "Transcribe live speech and audio files on-device",
      },
    ],
  },
  {
    title: "Vision",
    items: [
      {
        title: "Background Removal, Labels & OCR",
        href: "/guides/vision",
        description: "Cut out subjects, label images, and read text on-device",
      },
    ],
  },
  {
    title: "Embeddings",
    items: [
      {
        title: "Embeddings",
        href: "/guides/embeddings",
        description: "Semantic search and retrieval over your own data",
      },
    ],
  },
  {
    title: "Models & Platforms",
    items: [
      {
        title: "Models",
        href: "/guides/models",
        description: "Use OS models, download open models, or bring your own",
      },
      {
        title: "Platform Support",
        href: "/guides/platform-support",
        description: "Compare iOS and Android requirements and capabilities",
      },
      {
        title: "Android Setup",
        href: "/guides/android-setup",
        description: "Configure ML Kit and the optional Android features",
      },
      {
        title: "Vercel AI SDK",
        href: "/guides/vercel-ai-sdk",
        description: "Use the AI SDK with on-device language, embedding, and speech models",
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
        title: "Text",
        href: "/api#text",
        description: "isAvailable, prepareBuiltInModel, sendMessage, streamMessage, generateObject, generateText",
      },
      {
        title: "Speech",
        href: "/api#speech-to-text",
        description: "transcribe(), streamTranscription(), and the speech lifecycle",
      },
      {
        title: "Vision",
        href: "/api#vision",
        description: "removeBackground(), labelImage(), recognizeText(), and the vision lifecycle",
      },
      {
        title: "Embeddings",
        href: "/api#embeddings",
        description: "embed(), the embedding lifecycle, and the retrieval toolkit",
      },
      {
        title: "Models",
        href: "/api#model-management",
        description: "Discover, download, activate, remove, and register models",
      },
      {
        title: "AI SDK Provider",
        href: "/api#ai-sdk-provider",
        description: "Use expo-ai-kit through the Vercel AI SDK",
      },
      {
        title: "Config Plugin",
        href: "/api#config-plugin",
        description: "Opt-in flags: speech, vision, androidEmbeddings",
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
