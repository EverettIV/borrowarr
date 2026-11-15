"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import axios from "axios";
import "../styles/DirectoryPicker.scss";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3013";

interface Directory {
  name: string;
  path: string;
  isSymlink?: boolean;
}

interface DirectoryBrowserResponse {
  currentPath: string;
  parentPath: string | null;
  directories: Directory[];
}

interface DirectoryPickerProps {
  value: string | null;
  onChange: (path: string) => void;
  label: React.ReactNode;
  placeholder?: string;
}

const DirectoryPicker: React.FC<DirectoryPickerProps> = ({
  value,
  onChange,
  label,
  placeholder = "Select a directory",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState<string>("/");
  const [directories, setDirectories] = useState<Directory[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const getStartPath = useCallback(() => {
    if (value) {
      return value;
    }
    if (typeof window !== "undefined") {
      const isWindows = navigator.platform.toLowerCase().includes("win");
      if (isWindows) {
        return "C:\\";
      }
    }
    return "/";
  }, [value]);

  const resetPickerState = () => {
    abortRef.current?.abort();
    setDirectories([]);
    setCurrentPath("/");
    setParentPath(null);
    setFilterQuery("");
    setError(null);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    if (isOpen) {
      fetchDirectories(getStartPath());
    } else {
      resetPickerState();
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [isOpen, getStartPath]);

  const fetchDirectories = async (path: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRefreshing(true);
    setError(null);
    if (directories.length === 0) {
      setLoading(true);
    }

    try {
      const token = localStorage.getItem("accessToken");
      const response = await axios.get<DirectoryBrowserResponse>(
        `${API_BASE_URL}/api/Settings/browse?currentPath=${encodeURIComponent(path)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        },
      );

      if (controller.signal.aborted) {
        return;
      }

      setCurrentPath(response.data.currentPath);
      setDirectories(response.data.directories);
      setParentPath(response.data.parentPath);
      setFilterQuery("");
      listRef.current?.scrollTo(0, 0);
    } catch (error: unknown) {
      if (axios.isCancel(error)) {
        return;
      }
      console.error("Error fetching directories:", error);
      const message =
        axios.isAxiosError(error) && error.response?.data?.error
          ? String(error.response.data.error)
          : "Failed to load directories";
      setError(message);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  const filteredDirectories = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) {
      return directories;
    }
    return directories.filter((dir) => dir.name.toLowerCase().includes(query));
  }, [directories, filterQuery]);

  const handleDirectoryClick = (dir: Directory) => {
    fetchDirectories(dir.path);
  };

  const handleParentClick = () => {
    if (parentPath) {
      fetchDirectories(parentPath);
    }
  };

  const handleSelect = () => {
    onChange(currentPath);
    setIsOpen(false);
  };

  const handleCancel = () => {
    setIsOpen(false);
  };

  const handleManualInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const showEmptyMessage =
    !loading &&
    filteredDirectories.length === 0 &&
    (filterQuery.trim().length > 0 ||
      (!parentPath && directories.length === 0));

  return (
    <div className="directory-picker">
      <label>{label}</label>

      <div className="input-with-button">
        <input
          className="directory-input"
          onChange={handleManualInput}
          placeholder={placeholder}
          type="text"
          value={value || ""}
        />
        <button
          className="browse-button"
          onClick={() => setIsOpen(true)}
          type="button"
        >
          Browse...
        </button>
      </div>

      {isOpen && (
        <>
          <div className="modal-overlay" onClick={handleCancel} />
          <div className="directory-picker-modal">
            <div className="modal-header">
              <h3>Select Directory</h3>
              <button
                aria-label="Close"
                className="close-button"
                onClick={handleCancel}
                type="button"
              >
                ×
              </button>
            </div>

            <div className="modal-body">
              <div className="current-path" title={currentPath}>
                <strong>Current:</strong> {currentPath}
              </div>

              {directories.length > 8 && (
                <input
                  className="directory-filter"
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="Filter folders…"
                  type="search"
                  value={filterQuery}
                />
              )}

              {error && <div className="error-message">{error}</div>}

              {loading ? (
                <div className="loading">Loading directories...</div>
              ) : (
                <div
                  className={`directory-list${refreshing ? " is-refreshing" : ""}`}
                  ref={listRef}
                >
                  {refreshing && (
                    <div aria-live="polite" className="list-status">
                      Updating…
                    </div>
                  )}

                  {parentPath && (
                    <div
                      className="directory-item parent"
                      onClick={handleParentClick}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleParentClick();
                        }
                      }}
                    >
                      <span className="icon">📁</span>
                      <span className="name">..</span>
                    </div>
                  )}

                  {showEmptyMessage && (
                    <div className="empty-message">
                      {filterQuery.trim()
                        ? "No folders match your filter"
                        : "No subdirectories found"}
                    </div>
                  )}

                  {filteredDirectories.map((dir) => (
                    <div
                      className="directory-item"
                      key={dir.path}
                      onClick={() => handleDirectoryClick(dir)}
                      role="button"
                      tabIndex={0}
                      title={dir.path}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleDirectoryClick(dir);
                        }
                      }}
                    >
                      <span className="icon">{dir.isSymlink ? "🔗" : "📁"}</span>
                      <span className="name">{dir.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="cancel-button"
                onClick={handleCancel}
                type="button"
              >
                Cancel
              </button>
              <button
                className="select-button"
                disabled={refreshing || loading}
                onClick={handleSelect}
                title={currentPath}
                type="button"
              >
                Select this folder
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default DirectoryPicker;