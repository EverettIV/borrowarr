import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Settings",
  description: "BorrowArr server and application settings.",
  noIndex: true,
});

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}