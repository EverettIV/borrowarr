import type { Metadata } from "next";
import { siteConfig } from "@/config/site";

type PageMetadataOptions = {
  title?: string;
  description?: string;
  /** Force noindex even when public indexing is enabled (e.g. login). */
  noIndex?: boolean;
};

function defaultRobots(noIndex: boolean): Metadata["robots"] {
  const block = noIndex || !siteConfig.allowSearchIndexing;
  if (!block) {
    return { index: true, follow: true };
  }
  return {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  };
}

export function createPageMetadata({
  title,
  description,
  noIndex = false,
}: PageMetadataOptions): Metadata {
  const resolvedDescription = description ?? siteConfig.description;

  return {
    ...(title ? { title } : {}),
    description: resolvedDescription,
    robots: defaultRobots(noIndex),
    openGraph: {
      title: title ? `${title} - ${siteConfig.name}` : siteConfig.name,
      description: resolvedDescription,
    },
    twitter: {
      title: title ? `${title} - ${siteConfig.name}` : siteConfig.name,
      description: resolvedDescription,
    },
  };
}

export function rootMetadata(): Metadata {
  const metadataBase = siteConfig.url
    ? new URL(siteConfig.url)
    : undefined;

  return {
    metadataBase,
    title: {
      default: siteConfig.name,
      template: `%s - ${siteConfig.name}`,
    },
    description: siteConfig.description,
    applicationName: siteConfig.name,
    robots: defaultRobots(false),
    openGraph: {
      type: "website",
      locale: "en_US",
      siteName: siteConfig.name,
      title: siteConfig.name,
      description: siteConfig.description,
      ...(siteConfig.url ? { url: siteConfig.url } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: siteConfig.name,
      description: siteConfig.description,
    },
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      ],
      apple: [
        {
          url: "/apple-touch-icon.png",
          sizes: "180x180",
          type: "image/png",
        },
      ],
    },
    manifest: "/site.webmanifest",
  };
}