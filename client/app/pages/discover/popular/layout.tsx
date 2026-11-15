import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Popular",
  description: "Popular movies and TV shows on BorrowArr.",
});

export default function DiscoverPopularLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}