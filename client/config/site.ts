export type SiteConfig = typeof siteConfig;

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

export const siteConfig = {
  name: "BorrowArr",
  shortName: "BorrowArr",
  description:
    "Self-hosted media management: discover movies and TV shows, search indexers, monitor releases, and manage downloads in one place.",
  url: siteUrl,
  /** Set NEXT_PUBLIC_ALLOW_SEARCH_INDEXING=true only for a public marketing or demo deploy. */
  allowSearchIndexing:
    process.env.NEXT_PUBLIC_ALLOW_SEARCH_INDEXING === "true",
  links: {} as Record<string, string>,
};