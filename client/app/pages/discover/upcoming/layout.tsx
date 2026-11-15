import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Upcoming",
  description: "Upcoming movie and TV releases.",
});

export default function DiscoverUpcomingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}