import type { Metadata } from "next";

export const siteConfig = {
  name: "expo-ai-kit",
  title: "expo-ai-kit — On-device AI for Expo & React Native",
  description:
    "Run language models, structured output, tool calling, embeddings, and RAG locally in Expo and React Native apps.",
  url: "https://expo-ai-kit.dev",
  author: {
    name: "Said Kaban",
    url: "https://github.com/saidkaban",
  },
  repository: "https://github.com/saidkaban/expo-ai-kit",
  npm: "https://www.npmjs.com/package/expo-ai-kit",
} as const;

export function createPageMetadata(
  title: string,
  description: string,
  path: string
): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: `${title} — ${siteConfig.name}`,
      description,
      url: path,
      type: "article",
      images: [{ url: "/og.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} — ${siteConfig.name}`,
      description,
      images: ["/og.png"],
    },
  };
}
