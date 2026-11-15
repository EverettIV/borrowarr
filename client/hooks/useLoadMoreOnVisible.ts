import { RefObject, useEffect } from "react";

/**
 * Triggers onLoadMore when the sentinel enters (or nears) the viewport.
 * Uses a generous rootMargin so the next page loads before the user hits the bottom.
 */
export function useLoadMoreOnVisible(
  sentinelRef: RefObject<HTMLElement | null>,
  {
    enabled,
    onLoadMore,
    rootMargin = "800px 0px 400px 0px",
  }: {
    enabled: boolean;
    onLoadMore: () => void;
    rootMargin?: string;
  },
) {
  useEffect(() => {
    if (!enabled) return;

    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      },
      { root: null, rootMargin, threshold: 0 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, onLoadMore, rootMargin, sentinelRef]);
}