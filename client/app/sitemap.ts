import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

const PUBLIC_PATHS = [
  "/pages/discover",
  "/pages/discover/movies",
  "/pages/discover/series",
  "/pages/discover/popular",
  "/pages/discover/trending",
  "/pages/discover/upcoming",
  "/pages/featuredlists",
];

export default function sitemap(): MetadataRoute.Sitemap {
  if (!siteConfig.allowSearchIndexing || !siteConfig.url) {
    return [];
  }

  const now = new Date();

  return PUBLIC_PATHS.map((path, index) => ({
    url: `${siteConfig.url}${path}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: index === 0 ? 1 : 0.7,
  }));
}