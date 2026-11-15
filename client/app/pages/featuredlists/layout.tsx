import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Featured Lists",
  description: "Curated movie lists from Letterboxd, TMDb, and more.",
});

export default function FeaturedListsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}