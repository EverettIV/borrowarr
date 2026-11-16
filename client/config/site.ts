export type SiteConfig = typeof siteConfig;

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

export const siteConfig = {
  name: "BorrowArr",
  shortName: "BorrowArr",
  description:
    "Self-hosted movie and TV collection manager: TMDb discovery, indexer search, quality profiles, and download client integration.",
  url: siteUrl,
  /** Set NEXT_PUBLIC_ALLOW_SEARCH_INDEXING=true only for a public marketing or demo deploy. */
  allowSearchIndexing:
    process.env.NEXT_PUBLIC_ALLOW_SEARCH_INDEXING === "true",
  links: {} as Record<string, string>,
};