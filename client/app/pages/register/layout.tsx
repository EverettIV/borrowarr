import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Register",
  noIndex: true,
});

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}