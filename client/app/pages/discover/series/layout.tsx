import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "TV Series",
  description: "Explore TV series, seasons, and episodes.",
});

export default function DiscoverSeriesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}