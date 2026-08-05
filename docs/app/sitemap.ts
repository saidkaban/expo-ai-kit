import type { MetadataRoute } from "next";
import { navigation } from "@/lib/navigation";
import { siteConfig } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = new Set(
    navigation.flatMap((section) =>
      section.items.map((item) => item.href.split("#")[0])
    )
  );

  return [...paths].map((path) => ({
    url: new URL(path, siteConfig.url).toString(),
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/get-started" ? 0.9 : 0.7,
  }));
}
