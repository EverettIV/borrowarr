import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Discover",
  description:
    "Browse movies and TV shows, trending titles, and curated lists.",
});

export default function DiscoverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}