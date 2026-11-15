import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Movies",
  description: "Discover and browse movies with ratings, filters, and details.",
});

export default function DiscoverMoviesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}