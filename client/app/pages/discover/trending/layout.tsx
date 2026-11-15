import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Trending",
  description: "Trending movies and TV shows right now.",
});

export default function DiscoverTrendingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}