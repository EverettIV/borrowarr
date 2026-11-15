"use client";

import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Spinner,
} from "@heroui/react";
import { Search } from "lucide-react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3013";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

export type TmdbSearchResult = {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  poster_path?: string | null;
  posterUrl?: string | null;
  poster_url?: string;
  media_type?: string;
};

function posterUrlForResult(r: TmdbSearchResult): string | null {
  if (r.posterUrl) return r.posterUrl;
  if (r.poster_url) return r.poster_url;
  if (r.poster_path) return `${TMDB_IMAGE_BASE}${r.poster_path}`;
  return null;
}

type RenameTmdbPickerModalProps = {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: string;
  fileLabel?: string;
  onSelect: (result: { id: number; title: string; year?: number }) => void;
};

export function RenameTmdbPickerModal({
  isOpen,
  onClose,
  initialQuery = "",
  fileLabel,
  onSelect,
}: RenameTmdbPickerModalProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("accessToken");
      const res = await axios.get(`${API_BASE_URL}/api/TMDB/search`, {
        params: { query: trimmed, type: "movie", page: 1 },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const list = (res.data?.results || []).filter(
        (r: TmdbSearchResult) => (r.media_type || "movie") === "movie" || r.title,
      );
      setResults(list);
    } catch (err: unknown) {
      setError("Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setQuery(initialQuery);
      if (initialQuery.trim()) {
        void runSearch(initialQuery);
      } else {
        setResults([]);
      }
    }
  }, [isOpen, initialQuery, runSearch]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} scrollBehavior="inside" size="2xl">
      <ModalContent>
        <ModalHeader>Pick TMDB movie</ModalHeader>
        <ModalBody className="gap-3">
          {fileLabel ? (
            <p className="text-xs text-default-500 font-mono break-all">
              File: {fileLabel}
            </p>
          ) : null}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch(query);
            }}
          >
            <Input
              className="flex-1"
              onValueChange={setQuery}
              placeholder="Search TMDB…"
              size="sm"
              startContent={<Search className="text-default-400" size={16} />}
              value={query}
              variant="bordered"
            />
            <Button color="primary" isLoading={loading} size="sm" type="submit">
              Search
            </Button>
          </form>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner size="sm" />
            </div>
          ) : results.length === 0 ? (
            <p className="text-sm text-default-500 py-6 text-center">
              {query.trim() ? "No results" : "Enter a title to search"}
            </p>
          ) : (
            <ul className="space-y-2 max-h-96 overflow-y-auto">
              {results.map((r) => {
                const title = r.title || r.name || "Untitled";
                const year = r.release_date
                  ? r.release_date.slice(0, 4)
                  : "";
                const posterUrl = posterUrlForResult(r);
                return (
                  <li key={r.id}>
                    <button
                      className="w-full flex items-center gap-3 p-2 rounded-lg border border-content3 hover:border-primary text-left transition-colors"
                      onClick={() =>
                        onSelect({
                          id: r.id,
                          title,
                          year: year ? parseInt(year, 10) : undefined,
                        })
                      }
                      type="button"
                    >
                      {posterUrl ? (
                        <img
                          alt={title}
                          className="w-10 h-14 object-cover rounded shrink-0"
                          src={posterUrl}
                        />
                      ) : (
                        <div className="w-10 h-14 bg-content2 rounded shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{title}</p>
                        <p className="text-xs text-default-500">
                          {year ? `${year} · ` : ""}TMDB {r.id}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ModalBody>
        <ModalFooter>
          <Button onPress={onClose} variant="light">
            Cancel
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}