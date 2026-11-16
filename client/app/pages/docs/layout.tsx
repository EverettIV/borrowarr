import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Documentation",
  description:
    "Overview and links for self-hosting and configuring BorrowArr.",
});

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}