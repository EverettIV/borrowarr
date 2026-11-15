import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({ title: "Account", noIndex: true });

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}