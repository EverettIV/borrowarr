"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { Button, Chip, Input, Spinner } from "@heroui/react";
import { RefreshCw, Search, ChevronDown, ChevronRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3013";

export type ActivityLogStatus = "success" | "failure" | "info";

export type ActivityLogEntry = {
  id: number;
  category: string;
  action: string;
  status: ActivityLogStatus;
  summary: string;
  details: Record<string, unknown> | null;
  createdAt: string;
};

export type ActivityLogPanelProps = {
  /** Server category filter, e.g. file_rename */
  category?: string;
  /** Match actions starting with this prefix, e.g. movie_ or series_ */
  actionPrefix?: string;
  title?: string;
  description?: string;
  defaultLimit?: number;
  emptyMessage?: string;
  /** Show search box */
  searchable?: boolean;
  /** Status filter chips (success / failure / …) */
  showStatusFilter?: boolean;
  className?: string;
  /** Increment to refetch from scratch */
  refreshToken?: number;
  /** Admins see activity for all users (household log) */
  scopeAllForAdmin?: boolean;
};

type StatusFilter = "all" | ActivityLogStatus;

const STATUS_COLOR: Record<
  ActivityLogStatus,
  "secondary" | "danger" | "default"
> = {
  success: "secondary",
  failure: "danger",
  info: "default",
};

const STATUS_FILTER_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "success", label: "Success" },
  { id: "failure", label: "Failure" },
  { id: "info", label: "Info" },
];

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function detailLines(details: Record<string, unknown> | null): string[] {
  if (!details) return [];
  const lines: string[] = [];
  const paths = [
    "currentPath",
    "newPath",
    "from",
    "to",
    "sourcePath",
    "destPath",
    "destinationPath",
  ];
  for (const key of paths) {
    const v = details[key];
    if (typeof v === "string" && v.trim()) {
      lines.push(`${key}: ${v}`);
    }
  }
  if (typeof details.error === "string") {
    lines.push(`error: ${details.error}`);
  }
  if (typeof details.trigger === "string") {
    lines.push(`trigger: ${details.trigger}`);
  }
  if (typeof details.mediaDirectory === "string" && details.mediaDirectory) {
    lines.push(`folder: ${details.mediaDirectory}`);
  }
  if (Array.isArray(details.highlights)) {
    for (const line of details.highlights) {
      if (typeof line === "string" && line.trim()) {
        lines.push(line);
      }
    }
  }
  return lines;
}

export function ActivityLogPanel({
  category,
  actionPrefix,
  title = "Activity log",
  description,
  defaultLimit = 30,
  emptyMessage = "No activity recorded yet.",
  searchable = true,
  showStatusFilter = true,
  className = "",
  refreshToken = 0,
  scopeAllForAdmin = false,
}: ActivityLogPanelProps) {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.permissions?.admin);
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const listRef = useRef<HTMLUListElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);

  const fetchPage = useCallback(
    async (pageNum: number, mode: "replace" | "append") => {
      const isInitial = mode === "replace";
      if (isInitial) {
        setLoading(true);
        setError(null);
      } else {
        if (loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
      }

      try {
        const token = localStorage.getItem("accessToken");
        const params: Record<string, string | number> = {
          page: pageNum,
          limit: defaultLimit,
        };
        if (category) params.category = category;
        if (scopeAllForAdmin && isAdmin) params.scope = "all";
        if (actionPrefix) params.actionPrefix = actionPrefix;
        if (search.trim()) params.search = search.trim();
        if (statusFilter !== "all") params.status = statusFilter;

        const res = await axios.get(`${API_BASE_URL}/api/ActivityLog`, {
          params,
          headers: { Authorization: `Bearer ${token}` },
        });

        const chunk = res.data.data || [];
        const totalPages = res.data.totalPages || 1;

        setEntries((prev) => (mode === "replace" ? chunk : [...prev, ...chunk]));
        setHasMore(pageNum < totalPages);
        setPage(pageNum);
      } catch (err: unknown) {
        const msg =
          axios.isAxiosError(err) && err.response?.data?.error
            ? String(err.response.data.error)
            : "Failed to load activity log";
        if (isInitial) {
          setError(msg);
          setEntries([]);
          setHasMore(false);
        }
      } finally {
        if (isInitial) {
          setLoading(false);
        } else {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      }
    },
    [actionPrefix, category, defaultLimit, isAdmin, scopeAllForAdmin, search, statusFilter],
  );

  const refreshFromStart = useCallback(() => {
    setPage(1);
    void fetchPage(1, "replace");
  }, [fetchPage]);

  useEffect(() => {
    void fetchPage(1, "replace");
  }, [fetchPage, refreshToken]);

  useEffect(() => {
    const root = listRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !hasMore || loading || loadingMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (observed) => {
        if (!observed[0]?.isIntersecting) return;
        void fetchPage(page + 1, "append");
      },
      { root, rootMargin: "80px", threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchPage, hasMore, loading, loadingMore, page]);

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          {description ? (
            <p className="text-xs text-default-500 mt-0.5">{description}</p>
          ) : null}
        </div>
        <Button
          isIconOnly
          onPress={refreshFromStart}
          size="sm"
          variant="flat"
          aria-label="Refresh activity log"
        >
          <RefreshCw size={16} />
        </Button>
      </div>

      {searchable ? (
        <Input
          aria-label="Search activity log"
          onValueChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search log…"
          size="sm"
          startContent={<Search className="text-default-400" size={14} />}
          value={search}
          variant="bordered"
          isClearable
          onClear={() => {
            setSearch("");
            setPage(1);
          }}
        />
      ) : null}

      {showStatusFilter ? (
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <Button
              color={
                statusFilter === opt.id
                  ? opt.id === "failure"
                    ? "danger"
                    : "secondary"
                  : "default"
              }
              key={opt.id}
              onPress={() => {
                setStatusFilter(opt.id);
                setPage(1);
              }}
              size="sm"
              variant={statusFilter === opt.id ? "flat" : "bordered"}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      ) : null}

      {loading && entries.length === 0 ? (
        <div className="flex justify-center py-8">
          <Spinner size="sm" />
        </div>
      ) : error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-default-500 py-4 text-center">
          {emptyMessage}
        </p>
      ) : (
        <ul
          ref={listRef}
          className="space-y-2 max-h-80 overflow-y-auto pr-1"
        >
          {entries.map((entry) => {
            const extra = detailLines(entry.details);
            const isOpen = expandedId === entry.id;
            return (
              <li
                className="rounded-lg border border-content3 p-2.5 text-sm space-y-1"
                key={entry.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Chip
                    color={STATUS_COLOR[entry.status]}
                    size="sm"
                    variant="flat"
                  >
                    {entry.status}
                  </Chip>
                  <span className="text-[10px] text-default-400">
                    {formatWhen(entry.createdAt)}
                  </span>
                </div>
                <p className="text-xs leading-snug break-words">
                  {entry.summary}
                </p>
                {extra.length > 0 || entry.details ? (
                  <button
                    className="flex items-center gap-1 text-[10px] text-default-400 hover:text-foreground"
                    onClick={() => setExpandedId(isOpen ? null : entry.id)}
                    type="button"
                  >
                    {isOpen ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )}
                    Details
                  </button>
                ) : null}
                {isOpen ? (
                  <div className="text-[10px] font-mono text-default-500 space-y-1 pt-1 border-t border-content3">
                    {extra.map((line) => (
                      <p className="break-all" key={line}>
                        {line}
                      </p>
                    ))}
                    {entry.details &&
                    extra.length < Object.keys(entry.details).length ? (
                      <pre className="whitespace-pre-wrap break-all text-[10px] opacity-80">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
          <div ref={sentinelRef} className="h-2 shrink-0" aria-hidden />
          {loadingMore ? (
            <li className="flex justify-center py-2 list-none">
              <Spinner size="sm" />
            </li>
          ) : null}
          {!hasMore && entries.length > 0 ? (
            <li className="text-center text-[10px] text-default-400 py-2 list-none">
              End of log
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

export default ActivityLogPanel;