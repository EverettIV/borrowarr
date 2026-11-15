import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  if (siteConfig.allowSearchIndexing && siteConfig.url) {
    return {
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/pages/login",
          "/pages/register",
          "/pages/settings",
          "/pages/account",
          "/pages/users",
          "/pages/indexers",
          "/pages/search",
          "/pages/system",
        ],
      },
      sitemap: `${siteConfig.url}/sitemap.xml`,
    };
  }

  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}