import { Info } from "lucide-react";
import type { ReactNode } from "react";

/** Top-of-section explainer — shared layout on File Management and related panels. */
export function SectionInfoCallout({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 flex items-start gap-3 p-4 rounded-lg bg-secondary/10 border border-secondary/20">
      <Info className="text-secondary flex-shrink-0 mt-0.5" size={20} />
      <div className="text-sm text-default-500">{children}</div>
    </div>
  );
}