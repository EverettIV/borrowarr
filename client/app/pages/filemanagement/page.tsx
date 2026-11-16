"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import axios from "axios";
import { addToast, Progress } from "@heroui/react";
import { YLogoLoader } from "@/components/YLogoLoader";
import { Button } from "@heroui/react";
import { Input } from "@heroui/react";
import { Card, CardBody, CardHeader } from "@heroui/react";
import { Chip } from "@heroui/react";
import { Switch } from "@heroui/react";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/react";
import {
  FolderOpen,
  Film,
  Tv,
  RefreshCw,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  HardDrive,
  Pencil,
  Eye,
  Download,
  AlertTriangle,
  Info,
  Clock,
  Zap,
  Play,
  Pause,
  FolderInput,
  FolderOutput,
  ArrowRight,
  Activity,
  FileCheck,
  Ban,
  CheckCircle2,
  List,
  Search,
} from "lucide-react";
import DirectoryPicker from "../../../components/DirectoryPicker";
import { ActivityLogPanel } from "../../../components/ActivityLogPanel";
import { AnomalyDetectorPanel } from "../../../components/AnomalyDetectorPanel";
import { IndexerDefinitionSyncCard } from "../../../components/IndexerDefinitionSyncCard";
import { SectionInfoCallout } from "../../../components/SectionInfoCallout";
import { RenameTmdbPickerModal } from "../../../components/RenameTmdbPickerModal";
import { useAuth } from "@/context/AuthContext";
import { PageContent, PageHeader } from "@/components/page-header";
import "../../../styles/FileManagement.scss";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3013";

type RenameBatchServerStatus = {
  status: "running" | "complete" | "failed";
  mediaKind: "movies" | "series";
  total: number;
  done: number;
  success: number;
  failed: number;
  activeNames: string[];
  error?: string | null;
};

interface FileSettings {
  id?: number;
  movieFileFormat: string;
  seriesFileFormat: string;
  autoRename: boolean;
  autoRenameInterval: number;
  autoRenameWarningShown: boolean;
  // Download Watcher settings
  downloadWatcherEnabled: boolean;
  movieWatcherEnabled: boolean;
  seriesWatcherEnabled: boolean;
  movieDownloadDirectory: string | null;
  seriesDownloadDirectory: string | null;
  movieWatcherDestination: string | null;
  seriesWatcherDestination: string | null;
  watcherInterval: number;
  watcherAutoApprove: boolean;
  applyNamingOnWatcherApprove?: boolean;
  applyNamingOnAutomaticMove?: boolean;
  movieNamingScanTarget: "media" | "download";
  movieNamingUseFolders: boolean;
  movieRenameCleanupReleaseFolder: boolean;
  seriesNamingScanTarget: "media" | "download";
  movieApplyNamingOnWatcherApprove: boolean;
  seriesApplyNamingOnWatcherApprove: boolean;
  movieApplyNamingOnAutomaticMove: boolean;
  seriesApplyNamingOnAutomaticMove: boolean;
  movieWatcherDownloadMode: "saved" | "custom";
  movieWatcherMediaMode: "saved" | "custom";
  movieWatcherCustomDownloadDirectory: string | null;
  movieWatcherCustomMediaDirectory: string | null;
  seriesWatcherDownloadMode: "saved" | "custom";
  seriesWatcherMediaMode: "saved" | "custom";
  seriesWatcherCustomDownloadDirectory: string | null;
  seriesWatcherCustomMediaDirectory: string | null;
  anomalyDetectorAutoScanEnabled: boolean;
  anomalyDetectorScanInterval: number;
  anomalyDetectorScanDirKey:
    | "movieMedia"
    | "movieDownload"
    | "seriesMedia"
    | "seriesDownload"
    | "custom";
  anomalyDetectorCustomScanPath: string | null;
  anomalyDetectorCheckDuplicates: boolean;
  anomalyDetectorCheckCorruption: boolean;
  anomalyDetectorCheckLargeFiles: boolean;
}

interface PendingFile {
  id: string;
  filename: string;
  sourcePath: string;
  destinationPath: string;
  type: "movie" | "series";
  size: number;
  detectedAt: string;
}

interface WatcherPreviewItem {
  type: "movie" | "series";
  kind: "file" | "folder";
  name: string;
  sourcePath: string;
  destinationPath?: string;
  size?: number;
  fileCount?: number;
  action: string;
  folderName?: string;
}

interface WatcherSkippedItem {
  type: "movie" | "series";
  kind?: "file" | "folder";
  name: string;
  sourcePath?: string;
  reason: string;
  detail?: string;
  fileCount?: number;
}

interface RenameItem {
  currentPath: string;
  currentName: string;
  newName: string;
  type: "movie" | "series";
  newPath?: string;
  directory?: string;
  movieId?: string | null;
  seriesId?: string;
  season?: number;
  episode?: number;
  needsReview?: boolean;
  reviewReasons?: string[];
  matchSource?: string;
  sceneName?: string;
  resolvedTitle?: string;
  tmdbId?: number | null;
}

const RENAME_REVIEW_LABELS: Record<string, string> = {
  title_mismatch: "New title doesn’t match the current filename",
  lookup_diverged: "TMDB title doesn’t match what we read from the file/folder",
  empty_target_name: "Could not build a target filename",
  low_confidence_match: "Weak TMDB match — verify before renaming",
  no_tmdb_match: "No TMDB match — pick a movie or fix the filename",
};

/** Full destination path for preview (updates when the user edits the new filename). */
function effectiveNewPath(item: RenameItem): string {
  const name = item.newName?.trim();
  if (!name) return item.newPath || "—";

  const normalizedName = name.replace(/\\/g, "/");
  const normalizedNewPath = item.newPath?.replace(/\\/g, "/");

  if (normalizedNewPath?.endsWith(normalizedName) && item.newPath) {
    return item.newPath;
  }

  if (!normalizedName.includes("/")) {
    if (item.directory) {
      const sep = item.directory.includes("\\") ? "\\" : "/";
      return `${item.directory.replace(/[/\\]+$/, "")}${sep}${name}`;
    }
    if (item.newPath) {
      const sep = item.newPath.includes("\\") ? "\\" : "/";
      const parts = item.newPath.split(/[/\\]/);
      parts[parts.length - 1] = name;
      return parts.join(sep);
    }
  }

  if (normalizedNewPath) {
    const depth = normalizedName.split("/").length;
    const parts = normalizedNewPath.split("/");
    const root = parts.slice(0, -depth).join("/");
    if (root) {
      const sep = item.newPath?.includes("\\") ? "\\" : "/";
      return `${root}/${normalizedName}`.split("/").join(sep);
    }
  }

  return name;
}

function RenameLocationPreview({
  item,
  needsReview,
  onNewNameChange,
}: {
  item: RenameItem;
  needsReview?: boolean;
  onNewNameChange: (value: string) => void;
}) {
  const destination = effectiveNewPath(item);
  const newNameIsPath = /[/\\]/.test(item.newName || "");

  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      <div className="flex w-full min-w-0 flex-col gap-2">
        <div className="w-full min-w-0">
          <CardLine
            label="From ·"
            labelClassName="text-default-400"
            path={item.currentPath}
            pathClassName="text-default-500"
          />
        </div>
        <div className="w-full min-w-0">
          <CardLine
            label="To ·"
            labelClassName="text-secondary"
            path={destination}
            pathClassName="text-secondary"
          />
        </div>
      </div>
      {!newNameIsPath ? (
        <div className="w-full min-w-0 border-t border-divider pt-3">
          <p className="mb-1.5 text-xs text-default-500">New filename</p>
          <Input
            aria-label="New filename"
            classNames={{
              base: "w-full",
              input: "font-mono text-xs",
              inputWrapper: needsReview ? "border-danger w-full" : "w-full",
            }}
            color={needsReview ? "danger" : "default"}
            onChange={(e) => onNewNameChange(e.target.value)}
            size="sm"
            value={item.newName}
            variant="bordered"
          />
        </div>
      ) : null}
    </div>
  );
}

function renameItemSearchHaystack(item: RenameItem): string {
  const dest = effectiveNewPath(item);
  return [
    item.currentName,
    item.currentPath,
    item.newName,
    item.newPath,
    dest,
    item.resolvedTitle,
    item.sceneName,
    item.matchSource,
    ...(item.reviewReasons || []).map(
      (r) => RENAME_REVIEW_LABELS[r] || r,
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesRenamePreviewSearch(item: RenameItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = renameItemSearchHaystack(item);
  return q.split(/\s+/).every((token) => hay.includes(token));
}

function CardLine({
  label,
  labelClassName,
  path,
  pathClassName,
}: {
  label: string;
  labelClassName: string;
  path: string;
  pathClassName: string;
}) {
  return (
    <div className="block w-full min-w-0">
      <div className={`text-[10px] font-medium leading-none ${labelClassName}`}>
        {label}
      </div>
      <div
        className={`mt-1 block w-full min-w-0 font-mono text-[10px] leading-normal break-all whitespace-normal ${pathClassName}`}
      >
        {path}
      </div>
    </div>
  );
}

interface RenamePreviewStats {
  scanned?: number;
  matched?: number;
  toRename?: number;
  alreadyNamed?: number;
  skipped?: Array<{ name: string; reason: string }>;
}

/** Single generic naming demo used across this page (not live library titles). */
const FILE_NAMING_EXAMPLES = {
  movieTitle: "Example Movie",
  releaseYear: "2017",
  quality: "720p",
  source: "BluRay",
  codec: "x264",
  releaseGroup: "GRP",
  seriesTitle: "Example Series",
  episodeTitle: "Example Episode",
  seasonPadded: "01",
  episodePadded: "01",
  ext: "mkv",
} as const;

const MOVIE_FORMAT_TOKENS = [
  "{Movie Title}",
  "{Release Year}",
  "{Quality}",
  "{Source}",
  "{Codec}",
  "{Audio}",
  "{Edition}",
  "{Release Group}",
] as const;

const SERIES_FORMAT_TOKENS = [
  "{Series Title}",
  "{season:00}",
  "{episode:00}",
  "{Episode Title}",
  "{Quality}",
  "{Source}",
  "{Codec}",
  "{Audio}",
] as const;

function FormatTokenChips({
  tokens,
  onInsert,
}: {
  tokens: readonly string[];
  onInsert: (token: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-default-500">Click to add to format</p>
      <div className="flex flex-wrap gap-1.5">
        {tokens.map((token) => (
          <Chip
            key={token}
            className="cursor-pointer hover:bg-secondary/20"
            onClick={() => onInsert(token)}
            size="sm"
            variant="flat"
          >
            <code className="text-xs">{token}</code>
          </Chip>
        ))}
      </div>
    </div>
  );
}

// Default settings for new users
const DEFAULT_SETTINGS: FileSettings = {
  movieFileFormat: "{Movie Title} ({Release Year})",
  seriesFileFormat:
    "{Series Title}/Season {season:00}/{Series Title} - S{season:00}E{episode:00} - {Episode Title}",
  autoRename: false,
  autoRenameInterval: 60,
  autoRenameWarningShown: false,
  // Download Watcher defaults
  downloadWatcherEnabled: false,
  movieWatcherEnabled: true,
  seriesWatcherEnabled: true,
  movieDownloadDirectory: null,
  seriesDownloadDirectory: null,
  movieWatcherDestination: null,
  seriesWatcherDestination: null,
  watcherInterval: 30,
  watcherAutoApprove: true,
  movieNamingScanTarget: "media",
  movieNamingUseFolders: false,
  movieRenameCleanupReleaseFolder: false,
  seriesNamingScanTarget: "media",
  movieApplyNamingOnWatcherApprove: true,
  seriesApplyNamingOnWatcherApprove: true,
  movieApplyNamingOnAutomaticMove: false,
  seriesApplyNamingOnAutomaticMove: false,
  movieWatcherDownloadMode: "saved",
  movieWatcherMediaMode: "saved",
  movieWatcherCustomDownloadDirectory: null,
  movieWatcherCustomMediaDirectory: null,
  seriesWatcherDownloadMode: "saved",
  seriesWatcherMediaMode: "saved",
  seriesWatcherCustomDownloadDirectory: null,
  seriesWatcherCustomMediaDirectory: null,
  anomalyDetectorAutoScanEnabled: false,
  anomalyDetectorScanInterval: 1800,
  anomalyDetectorScanDirKey: "movieMedia",
  anomalyDetectorCustomScanPath: null,
  anomalyDetectorCheckDuplicates: true,
  anomalyDetectorCheckCorruption: false,
  anomalyDetectorCheckLargeFiles: false,
};

const selectFieldClass =
  "w-full rounded-lg border border-content3 bg-content1 px-3 py-2 text-sm";

const AUTO_SAVE_MS = 900;

const SETTING_SAVE_LABELS: Record<string, string> = {
  movieFileFormat: "Movie file format",
  seriesFileFormat: "Series file format",
  movieNamingScanTarget: "Movie scan folder",
  seriesNamingScanTarget: "Series scan folder",
  movieNamingUseFolders: "Subfolder per movie",
  movieRenameCleanupReleaseFolder: "Delete release junk",
  movieApplyNamingOnWatcherApprove: "Movie naming on approve",
  seriesApplyNamingOnWatcherApprove: "Series naming on approve",
  movieApplyNamingOnAutomaticMove: "Movie naming on auto-move",
  seriesApplyNamingOnAutomaticMove: "Series naming on auto-move",
  downloadWatcherEnabled: "Automatic watch & move",
  movieWatcherEnabled: "Movies in Watch & Move",
  seriesWatcherEnabled: "Series in Watch & Move",
  movieDownloadDirectory: "Movie download folder",
  seriesDownloadDirectory: "Series download folder",
  movieWatcherDestination: "Movie media folder",
  seriesWatcherDestination: "Series media folder",
  watcherInterval: "Watcher interval",
  watcherAutoApprove: "Watcher auto-approve",
  movieWatcherDownloadMode: "Movie download path mode",
  movieWatcherMediaMode: "Movie media path mode",
  movieWatcherCustomDownloadDirectory: "Custom movie download path",
  movieWatcherCustomMediaDirectory: "Custom movie media path",
  seriesWatcherDownloadMode: "Series download path mode",
  seriesWatcherMediaMode: "Series media path mode",
  seriesWatcherCustomDownloadDirectory: "Custom Series download path",
  seriesWatcherCustomMediaDirectory: "Custom Series media path",
  anomalyDetectorAutoScanEnabled: "Anomaly auto-scan",
  anomalyDetectorScanInterval: "Anomaly scan interval",
  anomalyDetectorScanDirKey: "Anomaly scan folder",
  anomalyDetectorCustomScanPath: "Anomaly custom scan path",
  anomalyDetectorCheckDuplicates: "Anomaly duplicate check",
  anomalyDetectorCheckCorruption: "Anomaly corruption check",
  anomalyDetectorCheckLargeFiles: "Anomaly large-file check",
};

function buildSettingsPayload(settings: FileSettings) {
  return {
    ...settings,
    downloadWatcherEnabled: settings.downloadWatcherEnabled ?? false,
    movieWatcherEnabled: settings.movieWatcherEnabled ?? true,
    seriesWatcherEnabled: settings.seriesWatcherEnabled ?? true,
    movieDownloadDirectory: settings.movieDownloadDirectory || null,
    seriesDownloadDirectory: settings.seriesDownloadDirectory || null,
    movieWatcherDestination: settings.movieWatcherDestination || null,
    seriesWatcherDestination: settings.seriesWatcherDestination || null,
    watcherInterval: settings.watcherInterval || 30,
    watcherAutoApprove: settings.watcherAutoApprove ?? false,
    movieWatcherDownloadMode: settings.movieWatcherDownloadMode || "saved",
    movieWatcherMediaMode: settings.movieWatcherMediaMode || "saved",
    movieWatcherCustomDownloadDirectory:
      settings.movieWatcherCustomDownloadDirectory || null,
    movieWatcherCustomMediaDirectory:
      settings.movieWatcherCustomMediaDirectory || null,
    seriesWatcherDownloadMode: settings.seriesWatcherDownloadMode || "saved",
    seriesWatcherMediaMode: settings.seriesWatcherMediaMode || "saved",
    seriesWatcherCustomDownloadDirectory:
      settings.seriesWatcherCustomDownloadDirectory || null,
    seriesWatcherCustomMediaDirectory:
      settings.seriesWatcherCustomMediaDirectory || null,
    movieDirectory: settings.movieWatcherDestination || null,
    seriesDirectory: settings.seriesWatcherDestination || null,
    movieFileFormat:
      settings.movieFileFormat || DEFAULT_SETTINGS.movieFileFormat,
    seriesFileFormat:
      settings.seriesFileFormat || DEFAULT_SETTINGS.seriesFileFormat,
    movieNamingScanTarget: settings.movieNamingScanTarget || "media",
    movieNamingUseFolders: settings.movieNamingUseFolders === true,
    movieRenameCleanupReleaseFolder:
      settings.movieRenameCleanupReleaseFolder === true,
    seriesNamingScanTarget: settings.seriesNamingScanTarget || "media",
    movieApplyNamingOnWatcherApprove:
      settings.movieApplyNamingOnWatcherApprove ?? true,
    seriesApplyNamingOnWatcherApprove:
      settings.seriesApplyNamingOnWatcherApprove ?? true,
    movieApplyNamingOnAutomaticMove:
      settings.movieApplyNamingOnAutomaticMove ?? false,
    seriesApplyNamingOnAutomaticMove:
      settings.seriesApplyNamingOnAutomaticMove ?? false,
    anomalyDetectorAutoScanEnabled:
      settings.anomalyDetectorAutoScanEnabled === true,
    anomalyDetectorScanInterval: settings.anomalyDetectorScanInterval || 1800,
    anomalyDetectorScanDirKey:
      settings.anomalyDetectorScanDirKey || "movieMedia",
    anomalyDetectorCustomScanPath:
      settings.anomalyDetectorCustomScanPath || null,
    anomalyDetectorCheckDuplicates:
      settings.anomalyDetectorCheckDuplicates !== false,
    anomalyDetectorCheckCorruption:
      settings.anomalyDetectorCheckCorruption === true,
    anomalyDetectorCheckLargeFiles:
      settings.anomalyDetectorCheckLargeFiles === true,
    autoRename: false,
    autoRenameInterval: 60,
    autoRenameWarningShown: true,
    completedDownloadHandlingEnabled: false,
    completedDownloadHandlingImportEnabled: false,
  };
}

function saveLabelForChangedKeys(keys: string[]): string {
  if (keys.length === 1) {
    return SETTING_SAVE_LABELS[keys[0]] || keys[0];
  }
  if (keys.length === 2) {
    return keys.map((k) => SETTING_SAVE_LABELS[k] || k).join(", ");
  }
  return `${keys.length} settings`;
}

function truncatePath(path: string | null, max = 52) {
  if (!path) return "";
  if (path.length <= max) return path;
  const head = Math.floor((max - 1) / 2);
  const tail = max - 1 - head;
  return `${path.slice(0, head)}…${path.slice(-tail)}`;
}

function effectiveWatcherDownload(
  settings: FileSettings,
  kind: "movie" | "series",
) {
  if (kind === "movie") {
    if (
      settings.movieWatcherDownloadMode === "custom" &&
      settings.movieWatcherCustomDownloadDirectory
    ) {
      return settings.movieWatcherCustomDownloadDirectory;
    }
    return settings.movieDownloadDirectory;
  }
  if (
    settings.seriesWatcherDownloadMode === "custom" &&
    settings.seriesWatcherCustomDownloadDirectory
  ) {
    return settings.seriesWatcherCustomDownloadDirectory;
  }
  return settings.seriesDownloadDirectory;
}

function savedMediaFolder(
  settings: FileSettings,
  kind: "movie" | "series",
): string | null {
  return kind === "movie"
    ? settings.movieWatcherDestination
    : settings.seriesWatcherDestination;
}

function effectiveWatcherMedia(
  settings: FileSettings,
  kind: "movie" | "series",
) {
  if (kind === "movie") {
    if (
      settings.movieWatcherMediaMode === "custom" &&
      settings.movieWatcherCustomMediaDirectory
    ) {
      return settings.movieWatcherCustomMediaDirectory;
    }
    return settings.movieWatcherDestination;
  }
  if (
    settings.seriesWatcherMediaMode === "custom" &&
    settings.seriesWatcherCustomMediaDirectory
  ) {
    return settings.seriesWatcherCustomMediaDirectory;
  }
  return settings.seriesWatcherDestination;
}

const FileManagement = () => {
  const { user } = useAuth();

  const [settings, setSettings] = useState<FileSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const settingsBaselineRef = useRef<string | null>(null);
  const settingsHydratedRef = useRef(false);
  const skipNextAutoSaveRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renameBatchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const batchCompletionHandledRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Import state
  const [importingMovies, setImportingMovies] = useState(false);
  const [importingSeries, setImportingSeries] = useState(false);

  // Rename preview state
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renamePreview, setRenamePreview] = useState<RenameItem[]>([]);
  const [renamePreviewSearch, setRenamePreviewSearch] = useState("");
  const [activityLogRefresh, setActivityLogRefresh] = useState(0);
  const [renamePreviewStats, setRenamePreviewStats] = useState<{
    movies: RenamePreviewStats | null;
    series: RenamePreviewStats | null;
  }>({ movies: null, series: null });
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameType, setRenameType] = useState<"movies" | "series">("movies");
  const [renameBatchProgress, setRenameBatchProgress] = useState<{
    done: number;
    total: number;
    success: number;
    failed: number;
    activeNames: string[];
    mediaKind: "movies" | "series";
  } | null>(null);

  const filteredRenamePreview = useMemo(
    () =>
      renamePreview.filter((item) =>
        matchesRenamePreviewSearch(item, renamePreviewSearch),
      ),
    [renamePreview, renamePreviewSearch],
  );

  const renamePreviewNoConflictCount = useMemo(
    () => renamePreview.filter((r) => !r.needsReview).length,
    [renamePreview],
  );

  const [tmdbPickItem, setTmdbPickItem] = useState<RenameItem | null>(null);
  const [applyingTmdb, setApplyingTmdb] = useState(false);

  // Section expansion state
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(),
  );

  const [watchMoveLogRefresh, setWatchMoveLogRefresh] = useState(0);
  const [triggeringWatcher, setTriggeringWatcher] = useState(false);
  const [previewingWatcher, setPreviewingWatcher] = useState(false);
  const [watcherPreviewOpen, setWatcherPreviewOpen] = useState(false);
  const [watcherPreviewReady, setWatcherPreviewReady] = useState<
    WatcherPreviewItem[]
  >([]);
  const [watcherPreviewSkipped, setWatcherPreviewSkipped] = useState<
    WatcherSkippedItem[]
  >([]);
  const [watcherPreviewMessage, setWatcherPreviewMessage] = useState("");
  const [watcherPreviewAutoApprove, setWatcherPreviewAutoApprove] =
    useState(false);
  const [testingMovieDownloadDir, setTestingMovieDownloadDir] = useState(false);
  const [testingSeriesDownloadDir, setTestingSeriesDownloadDir] =
    useState(false);
  const [testingMovieWatcherDest, setTestingMovieWatcherDest] = useState(false);
  const [testingSeriesWatcherDest, setTestingSeriesWatcherDest] =
    useState(false);
  const [movieDownloadDirStatus, setMovieDownloadDirStatus] = useState<
    "untested" | "success" | "error"
  >("untested");
  const [seriesDownloadDirStatus, setSeriesDownloadDirStatus] = useState<
    "untested" | "success" | "error"
  >("untested");
  const [movieWatcherDestStatus, setMovieWatcherDestStatus] = useState<
    "untested" | "success" | "error"
  >("untested");
  const [seriesWatcherDestStatus, setSeriesWatcherDestStatus] = useState<
    "untested" | "success" | "error"
  >("untested");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [approvingFile, setApprovingFile] = useState<string | null>(null);
  const [rejectingFile, setRejectingFile] = useState<string | null>(null);

  // Modal state
  const [infoModal, setInfoModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: "success" | "error" | "info" | "warning";
  }>({
    isOpen: false,
    title: "",
    message: "",
    type: "info",
  });

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  useEffect(() => {
    if (user) {
      fetchSettings();
    }
  }, [user]);

  useEffect(() => {
    if (!settings.downloadWatcherEnabled) return;
    const id = setInterval(() => setWatchMoveLogRefresh((n) => n + 1), 15000);
    return () => clearInterval(id);
  }, [settings.downloadWatcherEnabled]);

  // Pending queue when manual approval is on (no background watcher required)
  useEffect(() => {
    if (!settings.watcherAutoApprove) {
      fetchPendingFiles();
      const interval = setInterval(fetchPendingFiles, 5000);
      return () => clearInterval(interval);
    }
  }, [settings.watcherAutoApprove]);

  const hasWatcherPathPair = Boolean(
    (settings.movieWatcherEnabled !== false &&
      effectiveWatcherDownload(settings, "movie") &&
      effectiveWatcherMedia(settings, "movie")) ||
      (settings.seriesWatcherEnabled !== false &&
        effectiveWatcherDownload(settings, "series") &&
        effectiveWatcherMedia(settings, "series")),
  );

  const watcherPathsPayload = () => ({
    movieDownloadDirectory: settings.movieDownloadDirectory || null,
    seriesDownloadDirectory: settings.seriesDownloadDirectory || null,
    movieWatcherDestination: settings.movieWatcherDestination || null,
    seriesWatcherDestination: settings.seriesWatcherDestination || null,
    movieWatcherDownloadMode: settings.movieWatcherDownloadMode || "saved",
    movieWatcherMediaMode: settings.movieWatcherMediaMode || "saved",
    movieWatcherCustomDownloadDirectory:
      settings.movieWatcherCustomDownloadDirectory || null,
    movieWatcherCustomMediaDirectory:
      settings.movieWatcherCustomMediaDirectory || null,
    seriesWatcherDownloadMode: settings.seriesWatcherDownloadMode || "saved",
    seriesWatcherMediaMode: settings.seriesWatcherMediaMode || "saved",
    seriesWatcherCustomDownloadDirectory:
      settings.seriesWatcherCustomDownloadDirectory || null,
    seriesWatcherCustomMediaDirectory:
      settings.seriesWatcherCustomMediaDirectory || null,
    watcherAutoApprove: settings.watcherAutoApprove ?? false,
    movieApplyNamingOnWatcherApprove:
      settings.movieApplyNamingOnWatcherApprove ?? true,
    seriesApplyNamingOnWatcherApprove:
      settings.seriesApplyNamingOnWatcherApprove ?? true,
    movieApplyNamingOnAutomaticMove:
      settings.movieApplyNamingOnAutomaticMove ?? false,
    seriesApplyNamingOnAutomaticMove:
      settings.seriesApplyNamingOnAutomaticMove ?? false,
    movieWatcherEnabled: settings.movieWatcherEnabled ?? true,
    seriesWatcherEnabled: settings.seriesWatcherEnabled ?? true,
  });

  const movieNamingScanPath = () =>
    (settings.movieNamingScanTarget ?? "media") === "download"
      ? settings.movieDownloadDirectory
      : settings.movieWatcherDestination;

  const seriesNamingScanPath = () =>
    (settings.seriesNamingScanTarget ?? "media") === "download"
      ? settings.seriesDownloadDirectory
      : settings.seriesWatcherDestination;

  const applyMovieFormatTokensToSample = (format: string) => {
    let name = format.trim();
    const s = FILE_NAMING_EXAMPLES;
    name = name.replace(/\{\[([^\]]+)\]\}/g, (_, token) => {
      const key = token.trim();
      if (key === "Quality" && s.quality) return `[${s.quality}]`;
      return "";
    });
    name = name.replace(/\{Quality\}/gi, s.quality);
    name = name.replace(/\{Movie Title\}/gi, s.movieTitle);
    name = name.replace(/\{Movie CleanTitle\}/gi, s.movieTitle);
    name = name.replace(/\{Release Year\}/gi, s.releaseYear);
    name = name.replace(/\{Source\}/gi, s.source);
    name = name.replace(/\{Codec\}/gi, s.codec);
    name = name.replace(/\{Release Group\}/gi, s.releaseGroup);
    name = name.replace(/\{[^}]+\}/g, "");
    return name.replace(/\s+/g, " ").trim();
  };

  const applySeriesFormatTokensToSample = (format: string) => {
    let name = format.trim();
    const s = FILE_NAMING_EXAMPLES;
    name = name.replace(/\{\[([^\]]+)\]\}/g, (_, token) => {
      const key = token.trim();
      if (key === "Quality" && s.quality) return `[${s.quality}]`;
      return "";
    });
    name = name.replace(/\{Series Title\}/gi, s.seriesTitle);
    name = name.replace(/\{Episode Title\}/gi, s.episodeTitle);
    name = name.replace(/\{season:00\}/gi, s.seasonPadded);
    name = name.replace(/\{episode:00\}/gi, s.episodePadded);
    name = name.replace(/\{Quality\}/gi, s.quality);
    name = name.replace(/\{Codec\}/gi, s.codec);
    name = name.replace(/\{[^}]+\}/g, "");
    return name.replace(/\s+/g, " ").trim();
  };

  const buildMovieNamingExampleBase = () =>
    applyMovieFormatTokensToSample(
      settings.movieFileFormat?.trim() || DEFAULT_SETTINGS.movieFileFormat,
    );

  const movieNamingLayoutExample = () => {
    const base = buildMovieNamingExampleBase();
    const scanRoot = movieNamingScanPath() || "…/your/movie/folder";
    const file = `${base}.${FILE_NAMING_EXAMPLES.ext}`;
    if (settings.movieNamingUseFolders) {
      return `${scanRoot}/${base}/${file}`;
    }
    return `${scanRoot}/${file}`;
  };

  const movieFormatSelection = useRef({ start: 0, end: 0 });
  const seriesFormatSelection = useRef({ start: 0, end: 0 });

  const syncFormatInputSelection = (
    e: React.SyntheticEvent<HTMLInputElement>,
    target: React.MutableRefObject<{ start: number; end: number }>,
  ) => {
    const input = e.currentTarget;
    target.current = {
      start: input.selectionStart ?? 0,
      end: input.selectionEnd ?? 0,
    };
  };

  const insertFormatToken = (
    field: "movieFileFormat" | "seriesFileFormat",
    token: string,
    selectionRef: React.MutableRefObject<{ start: number; end: number }>,
    inputId: string,
  ) => {
    const current =
      field === "movieFileFormat"
        ? settings.movieFileFormat
        : settings.seriesFileFormat;
    const inputEl = document.getElementById(inputId) as HTMLInputElement | null;
    const atCursor =
      inputEl && document.activeElement === inputEl
        ? selectionRef.current
        : { start: current.length, end: current.length };
    const { start, end } = atCursor;
    const next = current.slice(0, start) + token + current.slice(end);
    const caret = start + token.length;
    selectionRef.current = { start: caret, end: caret };
    setSettings({ ...settings, [field]: next });
    requestAnimationFrame(() => {
      const el = document.getElementById(inputId) as HTMLInputElement | null;
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  const formatBytes = (bytes?: number) => {
    if (bytes == null) return "";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const skipReasonLabel = (reason: string) => {
    switch (reason) {
      case "still_downloading":
        return "Still downloading (file size changing)";
      case "no_videos":
        return "No video files in folder";
      case "already_pending":
        return "Already in approval queue";
      case "source_not_accessible":
        return "Download folder not accessible";
      default:
        return reason;
    }
  };

  const fetchSettings = async () => {
    try {
      const token = localStorage.getItem("accessToken");
      const response = await axios.get(`${API_BASE_URL}/api/Settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // Merge with defaults, but preserve null values for optional fields
      const loadedSettings = {
        ...DEFAULT_SETTINGS,
        ...response.data,
        // Preserve null values for directories (don't overwrite with defaults)
        movieDownloadDirectory:
          response.data.movieDownloadDirectory ??
          DEFAULT_SETTINGS.movieDownloadDirectory,
        seriesDownloadDirectory:
          response.data.seriesDownloadDirectory ??
          DEFAULT_SETTINGS.seriesDownloadDirectory,
        movieWatcherDestination:
          response.data.movieWatcherDestination ??
          response.data.movieDirectory ??
          DEFAULT_SETTINGS.movieWatcherDestination,
        seriesWatcherDestination:
          response.data.seriesWatcherDestination ??
          response.data.seriesDirectory ??
          DEFAULT_SETTINGS.seriesWatcherDestination,
        // Ensure boolean fields are properly set
        downloadWatcherEnabled: response.data.downloadWatcherEnabled ?? false,
        movieWatcherEnabled: response.data.movieWatcherEnabled ?? true,
        seriesWatcherEnabled: response.data.seriesWatcherEnabled ?? true,
        watcherAutoApprove: response.data.watcherAutoApprove ?? false,
        movieNamingScanTarget:
          response.data.movieNamingScanTarget === "download"
            ? "download"
            : "media",
        movieNamingUseFolders: response.data.movieNamingUseFolders === true,
        movieRenameCleanupReleaseFolder:
          response.data.movieRenameCleanupReleaseFolder === true,
        seriesNamingScanTarget:
          response.data.seriesNamingScanTarget === "download"
            ? "download"
            : "media",
        movieApplyNamingOnWatcherApprove:
          response.data.movieApplyNamingOnWatcherApprove ??
          response.data.applyNamingOnWatcherApprove ??
          true,
        seriesApplyNamingOnWatcherApprove:
          response.data.seriesApplyNamingOnWatcherApprove ??
          response.data.applyNamingOnWatcherApprove ??
          true,
        movieApplyNamingOnAutomaticMove:
          response.data.movieApplyNamingOnAutomaticMove ??
          response.data.applyNamingOnAutomaticMove ??
          false,
        seriesApplyNamingOnAutomaticMove:
          response.data.seriesApplyNamingOnAutomaticMove ??
          response.data.applyNamingOnAutomaticMove ??
          false,
        autoRename: response.data.autoRename ?? false,
        // Ensure numeric fields have defaults
        watcherInterval: response.data.watcherInterval ?? 30,
        autoRenameInterval: response.data.autoRenameInterval ?? 60,
        movieWatcherDownloadMode:
          response.data.movieWatcherDownloadMode === "custom"
            ? "custom"
            : "saved",
        movieWatcherMediaMode:
          response.data.movieWatcherMediaMode === "custom" ? "custom" : "saved",
        movieWatcherCustomDownloadDirectory:
          response.data.movieWatcherCustomDownloadDirectory ?? null,
        movieWatcherCustomMediaDirectory:
          response.data.movieWatcherCustomMediaDirectory ?? null,
        seriesWatcherDownloadMode:
          response.data.seriesWatcherDownloadMode === "custom"
            ? "custom"
            : "saved",
        seriesWatcherMediaMode:
          response.data.seriesWatcherMediaMode === "custom" ? "custom" : "saved",
        seriesWatcherCustomDownloadDirectory:
          response.data.seriesWatcherCustomDownloadDirectory ?? null,
        seriesWatcherCustomMediaDirectory:
          response.data.seriesWatcherCustomMediaDirectory ?? null,
        anomalyDetectorAutoScanEnabled:
          response.data.anomalyDetectorAutoScanEnabled === true,
        anomalyDetectorScanInterval:
          response.data.anomalyDetectorScanInterval ?? 1800,
        anomalyDetectorScanDirKey:
          response.data.anomalyDetectorScanDirKey || "movieMedia",
        anomalyDetectorCustomScanPath:
          response.data.anomalyDetectorCustomScanPath ?? null,
        anomalyDetectorCheckDuplicates:
          response.data.anomalyDetectorCheckDuplicates !== false,
        anomalyDetectorCheckCorruption:
          response.data.anomalyDetectorCheckCorruption === true,
        anomalyDetectorCheckLargeFiles:
          response.data.anomalyDetectorCheckLargeFiles === true,
      };

      setSettings(loadedSettings);
      setLoading(false);
    } catch (error) {
      console.error("Error fetching settings:", error);
      // Use defaults if fetch fails
      setSettings(DEFAULT_SETTINGS);
      setMessage({
        type: "error",
        text: "Failed to load settings. Using defaults.",
      });
      setLoading(false);
    }
  };

  const fetchPendingFiles = async () => {
    try {
      const token = localStorage.getItem("accessToken");
      const response = await axios.get(
        `${API_BASE_URL}/api/Settings/download-watcher/pending`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      setPendingFiles(response.data.files || []);
    } catch (error) {
      console.error("Error fetching pending files:", error);
    }
  };

  const approveFile = async (fileId: string) => {
    setApprovingFile(fileId);
    try {
      const token = localStorage.getItem("accessToken");
      await axios.post(
        `${API_BASE_URL}/api/Settings/download-watcher/approve`,
        { fileId },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setMessage({ type: "success", text: "File moved successfully!" });
      fetchPendingFiles();
      setWatchMoveLogRefresh((n) => n + 1);
    } catch (error: any) {
      console.error("Error approving file:", error);
      setMessage({
        type: "error",
        text: error.response?.data?.error || "Failed to move file",
      });
    } finally {
      setApprovingFile(null);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const rejectFile = async (fileId: string) => {
    setRejectingFile(fileId);
    try {
      const token = localStorage.getItem("accessToken");
      await axios.post(
        `${API_BASE_URL}/api/Settings/download-watcher/reject`,
        { fileId },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setMessage({ type: "success", text: "File ignored" });
      fetchPendingFiles();
      setWatchMoveLogRefresh((n) => n + 1);
    } catch (error: any) {
      console.error("Error rejecting file:", error);
      setMessage({
        type: "error",
        text: error.response?.data?.error || "Failed to reject file",
      });
    } finally {
      setRejectingFile(null);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const approveAllFiles = async () => {
    for (const file of pendingFiles) {
      await approveFile(file.id);
    }
  };

  const previewWatcherMoves = async () => {
    if (!hasWatcherPathPair) {
      setInfoModal({
        isOpen: true,
        title: "Paths required",
        message:
          "Set at least one download folder and matching media folder before previewing.",
        type: "warning",
      });
      return;
    }

    setPreviewingWatcher(true);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await axios.post(
        `${API_BASE_URL}/api/Settings/download-watcher/preview`,
        watcherPathsPayload(),
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (response.data.success) {
        setWatcherPreviewReady(response.data.ready || []);
        setWatcherPreviewSkipped(response.data.skipped || []);
        setWatcherPreviewMessage(response.data.message || "");
        setWatcherPreviewAutoApprove(!!response.data.autoApprove);
        setWatcherPreviewOpen(true);
      } else {
        setMessage({
          type: "error",
          text: response.data.message || "Preview failed",
        });
      }
    } catch (error: any) {
      setMessage({
        type: "error",
        text: error.response?.data?.error || "Failed to preview moves",
      });
    } finally {
      setPreviewingWatcher(false);
      setTimeout(() => setMessage(null), 4000);
    }
  };

  const triggerWatcherScan = async () => {
    if (!hasWatcherPathPair) {
      setInfoModal({
        isOpen: true,
        title: "Paths required",
        message:
          "Set at least one download folder and matching media folder, or run scan with current paths.",
        type: "warning",
      });
      return;
    }

    setTriggeringWatcher(true);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await axios.post(
        `${API_BASE_URL}/api/Settings/download-watcher/trigger`,
        watcherPathsPayload(),
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (response.data.success) {
        setMessage({
          type: "success",
          text: response.data.message || "Scan completed",
        });
        setWatchMoveLogRefresh((n) => n + 1);
        if (!settings.watcherAutoApprove) {
          await fetchPendingFiles();
        }
      } else {
        setMessage({
          type: "error",
          text: response.data.message || "Scan failed",
        });
      }
    } catch (error: any) {
      console.error("Error triggering watcher scan:", error);
      setMessage({
        type: "error",
        text: error.response?.data?.error || "Failed to trigger scan",
      });
    } finally {
      setTriggeringWatcher(false);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const testDownloadDirectory = useCallback(
    async (
      type: "movie" | "series",
      directoryOverride?: string | null,
      options?: { quiet?: boolean },
    ) => {
      const quiet = options?.quiet ?? false;
      const directory =
        directoryOverride ??
        (type === "movie"
          ? settings.movieDownloadDirectory
          : settings.seriesDownloadDirectory);

      if (!directory || !String(directory).trim()) {
        if (!quiet) {
          setInfoModal({
            isOpen: true,
            title: "No Directory",
            message: `Please enter a ${type} download directory first.`,
            type: "warning",
          });
        }
        return;
      }

      if (type === "movie") {
        setTestingMovieDownloadDir(true);
        setMovieDownloadDirStatus("untested");
      } else {
        setTestingSeriesDownloadDir(true);
        setSeriesDownloadDirStatus("untested");
      }

      try {
        const token = localStorage.getItem("accessToken");
        const response = await axios.post(
          `${API_BASE_URL}/api/Settings/test-directory`,
          { directory },
          { headers: { Authorization: `Bearer ${token}` } },
        );

        if (response.data.accessible) {
          if (type === "movie") {
            setMovieDownloadDirStatus("success");
          } else {
            setSeriesDownloadDirStatus("success");
          }
          if (!quiet) {
            setMessage({
              type: "success",
              text: `${type === "movie" ? "Movie" : "Series"} download folder is accessible`,
            });
          }
        }
      } catch (error: any) {
        console.error("Error testing directory:", error);
        if (type === "movie") {
          setMovieDownloadDirStatus("error");
        } else {
          setSeriesDownloadDirStatus("error");
        }
        if (!quiet) {
          const errorMsg =
            error.response?.data?.error ||
            `Failed to access ${type} download folder`;
          setMessage({ type: "error", text: errorMsg });
        }
      } finally {
        if (type === "movie") {
          setTestingMovieDownloadDir(false);
        } else {
          setTestingSeriesDownloadDir(false);
        }
        if (!quiet) {
          setTimeout(() => setMessage(null), 3000);
        }
      }
    },
    [
      settings.movieDownloadDirectory,
      settings.seriesDownloadDirectory,
    ],
  );

  const testWatcherDestination = useCallback(
    async (
      type: "movie" | "series",
      directoryOverride?: string | null,
      options?: { quiet?: boolean },
    ) => {
      const quiet = options?.quiet ?? false;
      const directory =
        directoryOverride ??
        (type === "movie"
          ? settings.movieWatcherDestination
          : settings.seriesWatcherDestination);

      if (!directory || !String(directory).trim()) {
        if (!quiet) {
          setInfoModal({
            isOpen: true,
            title: "No Directory",
            message: `Please enter a ${type} media folder first.`,
            type: "warning",
          });
        }
        return;
      }

      if (type === "movie") {
        setTestingMovieWatcherDest(true);
        setMovieWatcherDestStatus("untested");
      } else {
        setTestingSeriesWatcherDest(true);
        setSeriesWatcherDestStatus("untested");
      }

      try {
        const token = localStorage.getItem("accessToken");
        const response = await axios.post(
          `${API_BASE_URL}/api/Settings/test-directory`,
          { directory },
          { headers: { Authorization: `Bearer ${token}` } },
        );

        if (response.data.accessible) {
          if (type === "movie") {
            setMovieWatcherDestStatus("success");
          } else {
            setSeriesWatcherDestStatus("success");
          }
          if (!quiet) {
            setMessage({
              type: "success",
              text: `${type === "movie" ? "Movie" : "Series"} media folder is accessible`,
            });
          }
        }
      } catch (error: any) {
        console.error("Error testing directory:", error);
        if (type === "movie") {
          setMovieWatcherDestStatus("error");
        } else {
          setSeriesWatcherDestStatus("error");
        }
        if (!quiet) {
          const errorMsg =
            error.response?.data?.error ||
            `Failed to access ${type} media folder`;
          setMessage({ type: "error", text: errorMsg });
        }
      } finally {
        if (type === "movie") {
          setTestingMovieWatcherDest(false);
        } else {
          setTestingSeriesWatcherDest(false);
        }
        if (!quiet) {
          setTimeout(() => setMessage(null), 3000);
        }
      }
    },
  [
      settings.movieWatcherDestination,
      settings.seriesWatcherDestination,
    ],
  );

  // Auto-test saved media directory paths when they change (debounced)
  useEffect(() => {
    if (loading || !user) return;

    const timer = window.setTimeout(() => {
      if (settings.movieDownloadDirectory?.trim()) {
        void testDownloadDirectory(
          "movie",
          settings.movieDownloadDirectory,
          { quiet: true },
        );
      }
      if (settings.movieWatcherDestination?.trim()) {
        void testWatcherDestination(
          "movie",
          settings.movieWatcherDestination,
          { quiet: true },
        );
      }
      if (settings.seriesDownloadDirectory?.trim()) {
        void testDownloadDirectory(
          "series",
          settings.seriesDownloadDirectory,
          { quiet: true },
        );
      }
      if (settings.seriesWatcherDestination?.trim()) {
        void testWatcherDestination(
          "series",
          settings.seriesWatcherDestination,
          { quiet: true },
        );
      }
    }, 650);

    return () => window.clearTimeout(timer);
  }, [
    loading,
    user,
    settings.movieDownloadDirectory,
    settings.movieWatcherDestination,
    settings.seriesDownloadDirectory,
    settings.seriesWatcherDestination,
    testDownloadDirectory,
    testWatcherDestination,
  ]);

  const persistSettings = useCallback(
    async (snapshot: FileSettings, label: string) => {
      if (saveInFlightRef.current) return;
      saveInFlightRef.current = true;
      setSaving(true);

      try {
        const token = localStorage.getItem("accessToken");
        const response = await axios.put(
          `${API_BASE_URL}/api/Settings`,
          buildSettingsPayload(snapshot),
          { headers: { Authorization: `Bearer ${token}` } },
        );

        const merged = { ...DEFAULT_SETTINGS, ...response.data };
        skipNextAutoSaveRef.current = true;
        setSettings(merged);
        settingsBaselineRef.current = JSON.stringify(merged);

        addToast({
          title: `Saved ${label}`,
          color: "secondary",
          timeout: 2800,
        });

        if (snapshot.downloadWatcherEnabled) {
          setWatchMoveLogRefresh((n) => n + 1);
        }
      } catch (error: unknown) {
        console.error("Error saving settings:", error);
        const errorMsg = axios.isAxiosError(error)
          ? error.response?.data?.error ||
            error.response?.data?.message ||
            "Failed to save settings"
          : "Failed to save settings";
        addToast({
          title: "Save failed",
          description: String(errorMsg),
          color: "danger",
          timeout: 5000,
        });
        setMessage({ type: "error", text: String(errorMsg) });
      } finally {
        saveInFlightRef.current = false;
        setSaving(false);
      }
    },
    [],
  );

  const persistSettingsRef = useRef(persistSettings);
  persistSettingsRef.current = persistSettings;

  useEffect(() => {
    if (loading) return;

    if (!settingsHydratedRef.current) {
      settingsHydratedRef.current = true;
      settingsBaselineRef.current = JSON.stringify(settings);
      return;
    }

    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      settingsBaselineRef.current = JSON.stringify(settings);
      return;
    }

    const baseline = settingsBaselineRef.current;
    if (!baseline) return;

    const currentJson = JSON.stringify(settings);
    if (currentJson === baseline) return;

    const prev = JSON.parse(baseline) as FileSettings;
    const changedKeys = (Object.keys(settings) as (keyof FileSettings)[]).filter(
      (key) =>
        JSON.stringify(settings[key]) !== JSON.stringify(prev[key]),
    );
    if (changedKeys.length === 0) return;

    const label = saveLabelForChangedKeys(changedKeys as string[]);

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      void persistSettingsRef.current(settingsRef.current, label);
    }, AUTO_SAVE_MS);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [settings, loading]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const importMedia = async (type: "movie" | "series") => {
    const directory = savedMediaFolder(settings, type);

    if (!directory) {
      setInfoModal({
        isOpen: true,
        title: "Configuration Required",
        message: `Please configure your ${type === "movie" ? "movie" : "Series"} directory first!`,
        type: "error",
      });
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: `Import ${type === "movie" ? "Movies" : "Series"}`,
      message: `This will scan your ${type === "movie" ? "movie" : "Series"} directory and add all found ${type === "movie" ? "movies" : "Series"} to your monitored list.\n\nDirectory: ${directory}\n\nContinue?`,
      onConfirm: async () => {
        setConfirmModal({ ...confirmModal, isOpen: false });

        if (type === "movie") {
          setImportingMovies(true);
        } else {
          setImportingSeries(true);
        }
        setMessage(null);

        try {
          const token = localStorage.getItem("accessToken");
          const response = await axios.post(
            `${API_BASE_URL}/api/Settings/import-${type === "movie" ? "movies" : "series"}`,
            { dryRun: false },
            {
              headers: { Authorization: `Bearer ${token}` },
              timeout: 300000,
            },
          );

          const { results } = response.data;

          let message = `Import Complete!\n\n`;
          message += `✅ Imported: ${results.imported} ${type === "movie" ? "movies" : "Series"}\n`;
          if (results.alreadyMonitored > 0) {
            message += `⏭️ Already monitored: ${results.alreadyMonitored}\n`;
          }
          if (results.errors > 0) {
            message += `❌ Errors: ${results.errors}\n`;
          }
          message += `\nTotal files scanned: ${results.total}`;

          setInfoModal({
            isOpen: true,
            title: "Import Complete",
            message,
            type: "success",
          });
          setMessage({
            type: "success",
            text: `Successfully imported ${results.imported} ${type === "movie" ? "movies" : "Series"}!`,
          });
        } catch (error: any) {
          console.error(`Error importing ${type}:`, error);
          const errorMsg =
            error.response?.data?.error ||
            error.message ||
            `Failed to import ${type}`;
          setInfoModal({
            isOpen: true,
            title: "Import Failed",
            message: errorMsg,
            type: "error",
          });
          setMessage({ type: "error", text: errorMsg });
        } finally {
          if (type === "movie") {
            setImportingMovies(false);
          } else {
            setImportingSeries(false);
          }
        }
      },
    });
  };

  const previewRenames = async (type: "movies" | "series") => {
    const scanPath =
      type === "movies" ? movieNamingScanPath() : seriesNamingScanPath();
    if (!scanPath) {
      const folderLabel =
        (type === "movies"
          ? settings.movieNamingScanTarget
          : settings.seriesNamingScanTarget) === "download"
          ? "download"
          : "media";
      setInfoModal({
        isOpen: true,
        title: "Configuration Required",
        message: `Set your ${type === "movies" ? "movie" : "Series"} ${folderLabel} folder in Media Directories first.`,
        type: "error",
      });
      return;
    }

    setLoadingPreview(true);
    setRenameType(type);
    setMessage(null);

    try {
      const token = localStorage.getItem("accessToken");
      const response = await axios.post(
        `${API_BASE_URL}/api/Settings/preview-renames`,
        {
          movieFileFormat:
            type === "movies" ? settings.movieFileFormat : undefined,
          seriesFileFormat:
            type === "series" ? settings.seriesFileFormat : undefined,
          type,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 600000,
        },
      );

      let allRenames: RenameItem[] = [];

      if (type === "movies") {
        allRenames = (response.data.movies || []).map((r: any) => ({
          ...r,
          type: "movie" as const,
        }));
        setRenamePreviewStats({
          movies: response.data.stats?.movies ?? null,
          series: null,
        });
      } else {
        allRenames = (response.data.series || []).map((r: any) => ({
          ...r,
          type: "series" as const,
        }));
        setRenamePreviewStats({
          movies: null,
          series: response.data.stats?.series ?? null,
        });
      }

      setRenamePreviewSearch("");
      setRenamePreview(
        [...allRenames].sort(
          (a, b) => Number(Boolean(b.needsReview)) - Number(Boolean(a.needsReview)),
        ),
      );
      setShowRenameModal(true);
    } catch (error: any) {
      console.error("Error previewing renames:", error);
      const errorMsg =
        error.response?.data?.error ||
        error.message ||
        "Failed to preview renames";
      setInfoModal({
        isOpen: true,
        title: "Preview Failed",
        message: errorMsg,
        type: "error",
      });
      setMessage({ type: "error", text: errorMsg });
    } finally {
      setLoadingPreview(false);
    }
  };

  const renamePayloadFromItem = (item: RenameItem) => ({
    movieId: item.movieId,
    seriesId: item.seriesId,
    currentPath: item.currentPath,
    currentName: item.currentName,
    newName: item.newName,
    newPath: item.newPath,
    directory: item.directory,
    season: item.season,
    episode: item.episode,
  });

  const stopRenameBatchPoll = () => {
    if (renameBatchPollRef.current) {
      clearInterval(renameBatchPollRef.current);
      renameBatchPollRef.current = null;
    }
  };

  const fetchRenameBatchStatus =
    async (): Promise<RenameBatchServerStatus | null> => {
      const token = localStorage.getItem("accessToken");
      const res = await axios.get(
        `${API_BASE_URL}/api/Settings/rename-batch/status`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      return res.data.batch ?? null;
    };

  const applyServerBatchProgress = (batch: RenameBatchServerStatus) => {
    setRenaming(batch.status === "running");
    setRenameBatchProgress({
      done: batch.done,
      total: batch.total,
      success: batch.success,
      failed: batch.failed,
      activeNames: batch.activeNames ?? [],
      mediaKind: batch.mediaKind,
    });
    setExpandedSections((prev) => {
      const next = new Set(prev);
      next.add(batch.mediaKind === "series" ? "seriesNaming" : "movieNaming");
      return next;
    });
  };

  const handleBatchFinished = async (batch: RenameBatchServerStatus) => {
    if (batchCompletionHandledRef.current) return;
    batchCompletionHandledRef.current = true;
    stopRenameBatchPoll();
    setRenameBatchProgress(null);
    setRenaming(false);
    setActivityLogRefresh((n) => n + 1);
    setInfoModal({
      isOpen: true,
      title: batch.status === "failed" ? "Rename Failed" : "Rename Complete",
      message:
        batch.status === "failed"
          ? batch.error || "Rename batch failed"
          : `✅ Renamed: ${batch.success} files\n❌ Failed: ${batch.failed} files`,
      type:
        batch.failed > 0 || batch.status === "failed" ? "error" : "success",
    });
    const token = localStorage.getItem("accessToken");
    try {
      await axios.post(
        `${API_BASE_URL}/api/Settings/rename-batch/dismiss`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } catch {
      /* ignore */
    }
    batchCompletionHandledRef.current = false;
  };

  const pollRenameBatchOnce = async () => {
    try {
      const batch = await fetchRenameBatchStatus();
      if (!batch) {
        stopRenameBatchPoll();
        setRenameBatchProgress(null);
        setRenaming(false);
        return;
      }
      applyServerBatchProgress(batch);
      if (batch.status === "running") {
        return;
      }
      await handleBatchFinished(batch);
    } catch {
      /* keep polling on transient errors */
    }
  };

  const startRenameBatchPoll = () => {
    stopRenameBatchPoll();
    void pollRenameBatchOnce();
    renameBatchPollRef.current = setInterval(() => {
      void pollRenameBatchOnce();
    }, 1500);
  };

  useEffect(() => () => stopRenameBatchPoll(), []);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const batch = await fetchRenameBatchStatus();
        if (!batch) return;
        if (batch.status === "running") {
          applyServerBatchProgress(batch);
          startRenameBatchPoll();
        } else if (batch.status === "complete" || batch.status === "failed") {
          applyServerBatchProgress(batch);
          await handleBatchFinished(batch);
        }
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resume once per login
  }, [user]);

  const postRenames = async (
    items: RenameItem[],
    type: "movies" | "series",
    options?: { timeoutMs?: number },
  ) => {
    const token = localStorage.getItem("accessToken");
    const response = await axios.post(
      `${API_BASE_URL}/api/Settings/execute-renames`,
      {
        renames: items.map(renamePayloadFromItem),
        type,
      },
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: options?.timeoutMs ?? 600_000,
      },
    );
    return response.data.results as {
      success: number;
      failed: number;
      errors: Array<{ currentName?: string; error?: string }>;
    };
  };

  const runBatchRenames = async (items: RenameItem[]) => {
    setShowRenameModal(false);
    setRenamePreviewSearch("");
    setMessage(null);
    batchCompletionHandledRef.current = false;

    try {
      const token = localStorage.getItem("accessToken");
      const renames = items.map((item) => ({
        ...renamePayloadFromItem(item),
        type: item.type === "series" ? "series" : "movie",
      }));
      const res = await axios.post(
        `${API_BASE_URL}/api/Settings/rename-batch/start`,
        { renames },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const batch = res.data.batch as RenameBatchServerStatus;
      setRenamePreview([]);
      applyServerBatchProgress(batch);
      startRenameBatchPoll();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } }; message?: string };
      setInfoModal({
        isOpen: true,
        title: "Rename Failed",
        message:
          err.response?.data?.error ||
          err.message ||
          "Could not start rename batch",
        type: "error",
      });
    }
  };

  const executeSingleRename = (item: RenameItem) => {
    const run = async () => {
      if (!item.newName?.trim()) {
        setInfoModal({
          isOpen: true,
          title: "Cannot Rename",
          message: "Enter a new filename first.",
          type: "error",
        });
        return;
      }

      setRenamingPath(item.currentPath);
      setMessage(null);

      try {
        const apiType = item.type === "movie" ? "movies" : "series";
        const results = await postRenames([item], apiType);
        setActivityLogRefresh((n) => n + 1);
        if (results.success > 0) {
          setRenamePreview((prev) => {
            const next = prev.filter((r) => r.currentPath !== item.currentPath);
            if (next.length === 0) setShowRenameModal(false);
            return next;
          });
          setMessage({
            type: "success",
            text: `Renamed: ${item.currentName} → ${item.newName}`,
          });
        } else {
          const err =
            results.errors?.[0]?.error || "Rename failed for this file.";
          setInfoModal({
            isOpen: true,
            title: "Rename Failed",
            message: err,
            type: "error",
          });
        }
      } catch (error: any) {
        const errorMsg =
          error.response?.data?.error ||
          error.message ||
          "Failed to rename file";
        setInfoModal({
          isOpen: true,
          title: "Rename Failed",
          message: errorMsg,
          type: "error",
        });
      } finally {
        setRenamingPath(null);
      }
    };

    void run();
  };

  const applyManualTmdbMatch = async (
    item: RenameItem,
    pick: { id: number; title: string },
  ) => {
    setApplyingTmdb(true);
    try {
      const token = localStorage.getItem("accessToken");
      const res = await axios.post(
        `${API_BASE_URL}/api/Settings/rename-apply-tmdb`,
        {
          currentPath: item.currentPath,
          movieFileFormat:
            settings.movieFileFormat || DEFAULT_SETTINGS.movieFileFormat,
          tmdbId: pick.id,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const row = res.data.rename;
      setRenamePreview((prev) =>
        prev.map((r) =>
          r.currentPath === item.currentPath
            ? {
                ...r,
                ...row,
                type: "movie" as const,
              }
            : r,
        ),
      );
      setTmdbPickItem(null);
      setMessage({
        type: "success",
        text: `Matched to ${pick.title} — preview updated`,
      });
    } catch (error: any) {
      const msg =
        error.response?.data?.error ||
        error.message ||
        "Failed to apply TMDB match";
      setInfoModal({
        isOpen: true,
        title: "TMDB match failed",
        message: msg,
        type: "error",
      });
    } finally {
      setApplyingTmdb(false);
    }
  };

  const executeRenamesSubset = (items: RenameItem[], confirmTitle: string) => {
    if (items.length === 0) {
      setInfoModal({
        isOpen: true,
        title: "Nothing to rename",
        message: "No files selected for this action.",
        type: "error",
      });
      return;
    }
    setConfirmModal({
      isOpen: true,
      title: confirmTitle,
      message: `Rename ${items.length} file(s)? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmModal((m) => ({ ...m, isOpen: false }));
        await runBatchRenames(items);
      },
    });
  };

  const executeRenamesWithoutConflict = () => {
    const safe = renamePreview.filter((r) => !r.needsReview);
    executeRenamesSubset(
      safe,
      "Rename files with no conflict",
    );
  };

  const executeRenames = () => {
    executeRenamesSubset(renamePreview, "Rename all files");
  };

  const getDirStatusIcon = (status: "untested" | "success" | "error") => {
    switch (status) {
      case "success":
        return <Check className="text-secondary" size={16} />;
      case "error":
        return <X className="text-danger" size={16} />;
      default:
        return null;
    }
  };

  const renderRenameBatchProgress = (mediaKind: "movies" | "series") => {
    if (!renameBatchProgress || renameBatchProgress.mediaKind !== mediaKind) {
      return null;
    }
    const accent = "secondary";
    return (
      <div className="pt-4 border-t border-content3 space-y-3 rounded-lg border border-secondary/40 bg-secondary/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Pencil className="text-secondary" size={18} />
            Renaming {mediaKind === "movies" ? "movies" : "Series episodes"}…
          </span>
          <span className="text-sm font-semibold tabular-nums">
            {renameBatchProgress.done}/{renameBatchProgress.total}
          </span>
        </div>
        <Progress
          aria-label="Rename progress"
          className="w-full"
          color={accent}
          size="md"
          value={
            renameBatchProgress.total > 0
              ? Math.round(
                  (renameBatchProgress.done / renameBatchProgress.total) * 100,
                )
              : 0
          }
        />
        {renameBatchProgress.activeNames.length > 0 ? (
          <div className="text-xs text-default-500 space-y-1 min-w-0">
            <p className="font-medium text-default-600">Working on:</p>
            {renameBatchProgress.activeNames.map((name) => (
              <p className="truncate font-mono" key={name}>
                {name}
              </p>
            ))}
          </div>
        ) : null}
        <p className="text-xs text-default-500">
          ✅ {renameBatchProgress.success} succeeded · ❌{" "}
          {renameBatchProgress.failed} failed
        </p>
      </div>
    );
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md mx-4">
          <CardBody className="text-center py-8">
            <AlertTriangle className="mx-auto mb-4 text-secondary" size={48} />
            <h2 className="text-xl font-bold mb-2">Authentication Required</h2>
            <p className="text-default-500">
              Please sign in to access file management settings.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader
          description="Configure media directories and file naming conventions"
          icon={<HardDrive className="h-6 w-6" />}
          title="File Management"
          tone="secondary"
        />

        <PageContent>
          <div className="flex flex-col items-center justify-center py-16 rounded-xl border border-secondary/20 bg-content1">
            <YLogoLoader color="secondary" size="lg" />
            <p className="mt-4 text-foreground/60">
              Loading file management settings...
            </p>
          </div>
        </PageContent>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        actions={
          saving ? (
            <Chip color="secondary" size="sm" variant="flat">
              Saving…
            </Chip>
          ) : (
            <Chip color="default" size="sm" variant="bordered">
              Changes save automatically
            </Chip>
          )
        }
        description="Configure media directories and file naming conventions"
        icon={<HardDrive className="h-6 w-6" />}
        title="File Management"
        tone="secondary"
      />

      {/* Content */}
      <PageContent>
        {/* Message */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-lg border ${
              message.type === "success"
                ? "bg-secondary/10 border-secondary/30 text-secondary"
                : "bg-danger/10 border-danger/30 text-danger"
            }`}
          >
            <div className="flex items-center gap-2">
              {message.type === "success" ? (
                <Check size={18} />
              ) : (
                <X size={18} />
              )}
              <span>{message.text}</span>
            </div>
          </div>
        )}

        <div className="space-y-6">
          {/* Media Directories Section */}
          <Card className="border border-content2">
            <CardHeader
              className="cursor-pointer hover:bg-content2/50 transition-colors"
              onClick={() => toggleSection("directories")}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  <FolderOpen className="text-secondary" size={24} />
                  <div>
                    <h2 className="text-lg font-semibold">Media Directories</h2>
                    <p className="text-sm text-default-500">
                      Saved download and media folders — used by import,
                      monitoring, rename, and watch & move
                    </p>
                  </div>
                </div>
                {expandedSections.has("directories") ? (
                  <ChevronDown size={20} />
                ) : (
                  <ChevronRight size={20} />
                )}
              </div>
            </CardHeader>
            {expandedSections.has("directories") && (
              <CardBody className="pt-0 space-y-8">
                <SectionInfoCallout>
                  For each type, set a download folder (where your client drops
                  finished files) and a media folder (your organized library on
                  disk). BorrowArr remembers these paths—import, monitoring,
                  rename, watch & move, and other sections on this page use
                  them automatically. Use Test to confirm the server can reach
                  each folder before you rely on it.
                </SectionInfoCallout>
                <div className="p-4 rounded-xl border border-secondary/30 bg-secondary/5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Film className="text-secondary" size={20} />
                    <h3 className="font-semibold text-secondary">Movies</h3>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Download className="text-default-400" size={14} />
                        <span className="text-sm font-medium">
                          Download folder
                        </span>
                        {getDirStatusIcon(movieDownloadDirStatus)}
                      </div>
                      <DirectoryPicker
                        label=""
                        onChange={(path) => {
                          setSettings({
                            ...settings,
                            movieDownloadDirectory: path,
                          });
                          setMovieDownloadDirStatus("untested");
                        }}
                        placeholder="/downloads/movies"
                        value={settings.movieDownloadDirectory}
                      />
                      <Button
                        color="default"
                        isDisabled={!settings.movieDownloadDirectory}
                        isLoading={testingMovieDownloadDir}
                        onPress={() => testDownloadDirectory("movie")}
                        size="sm"
                        startContent={
                          !testingMovieDownloadDir && <RefreshCw size={12} />
                        }
                        variant="flat"
                      >
                        Test
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <FolderOutput className="text-default-400" size={14} />
                        <span className="text-sm font-medium">
                          Media folder
                        </span>
                        {getDirStatusIcon(movieWatcherDestStatus)}
                      </div>
                      <DirectoryPicker
                        label=""
                        onChange={(path) => {
                          setSettings({
                            ...settings,
                            movieWatcherDestination: path,
                          });
                          setMovieWatcherDestStatus("untested");
                        }}
                        placeholder="/media/movies"
                        value={settings.movieWatcherDestination}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          color="default"
                          isDisabled={!settings.movieWatcherDestination}
                          isLoading={testingMovieWatcherDest}
                          onPress={() => testWatcherDestination("movie")}
                          size="sm"
                          startContent={
                            !testingMovieWatcherDest && (
                              <RefreshCw size={12} />
                            )
                          }
                          variant="flat"
                        >
                          Test
                        </Button>
                        <Button
                          color="secondary"
                          isDisabled={!settings.movieWatcherDestination}
                          isLoading={importingMovies}
                          onPress={() => importMedia("movie")}
                          size="sm"
                          startContent={
                            !importingMovies && <Download size={14} />
                          }
                          variant="flat"
                        >
                          Import Movies
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-secondary/30 bg-secondary/5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Tv className="text-secondary" size={20} />
                    <h3 className="font-semibold text-secondary">Series</h3>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Download className="text-default-400" size={14} />
                        <span className="text-sm font-medium">
                          Download folder
                        </span>
                        {getDirStatusIcon(seriesDownloadDirStatus)}
                      </div>
                      <DirectoryPicker
                        label=""
                        onChange={(path) => {
                          setSettings({
                            ...settings,
                            seriesDownloadDirectory: path,
                          });
                          setSeriesDownloadDirStatus("untested");
                        }}
                        placeholder="/downloads/series"
                        value={settings.seriesDownloadDirectory}
                      />
                      <Button
                        color="default"
                        isDisabled={!settings.seriesDownloadDirectory}
                        isLoading={testingSeriesDownloadDir}
                        onPress={() => testDownloadDirectory("series")}
                        size="sm"
                        startContent={
                          !testingSeriesDownloadDir && <RefreshCw size={12} />
                        }
                        variant="flat"
                      >
                        Test
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <FolderOutput className="text-default-400" size={14} />
                        <span className="text-sm font-medium">
                          Media folder
                        </span>
                        {getDirStatusIcon(seriesWatcherDestStatus)}
                      </div>
                      <DirectoryPicker
                        label=""
                        onChange={(path) => {
                          setSettings({
                            ...settings,
                            seriesWatcherDestination: path,
                          });
                          setSeriesWatcherDestStatus("untested");
                        }}
                        placeholder="/media/series"
                        value={settings.seriesWatcherDestination}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          color="default"
                          isDisabled={!settings.seriesWatcherDestination}
                          isLoading={testingSeriesWatcherDest}
                          onPress={() => testWatcherDestination("series")}
                          size="sm"
                          startContent={
                            !testingSeriesWatcherDest && (
                              <RefreshCw size={12} />
                            )
                          }
                          variant="flat"
                        >
                          Test
                        </Button>
                        <Button
                          color="secondary"
                          isDisabled={!settings.seriesWatcherDestination}
                          isLoading={importingSeries}
                          onPress={() => importMedia("series")}
                          size="sm"
                          startContent={
                            !importingSeries && <Download size={14} />
                          }
                          variant="flat"
                        >
                          Import Series
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardBody>
            )}
          </Card>

          <IndexerDefinitionSyncCard
            expanded={expandedSections.has("indexerDefinitions")}
            isAdmin={Boolean(user?.permissions?.admin)}
            onToggle={() => toggleSection("indexerDefinitions")}
          />

          <AnomalyDetectorPanel
            anomalyPrefs={{
              anomalyDetectorAutoScanEnabled:
                settings.anomalyDetectorAutoScanEnabled === true,
              anomalyDetectorScanInterval:
                settings.anomalyDetectorScanInterval || 1800,
              anomalyDetectorScanDirKey:
                settings.anomalyDetectorScanDirKey || "movieMedia",
              anomalyDetectorCustomScanPath:
                settings.anomalyDetectorCustomScanPath,
              anomalyDetectorCheckDuplicates:
                settings.anomalyDetectorCheckDuplicates !== false,
              anomalyDetectorCheckCorruption:
                settings.anomalyDetectorCheckCorruption === true,
              anomalyDetectorCheckLargeFiles:
                settings.anomalyDetectorCheckLargeFiles === true,
            }}
            expanded={expandedSections.has("anomalyDetector")}
            mediaDirs={{
              movieDownload: settings.movieDownloadDirectory,
              movieMedia: settings.movieWatcherDestination,
              seriesDownload: settings.seriesDownloadDirectory,
              seriesMedia: settings.seriesWatcherDestination,
            }}
            onAnomalyPrefsChange={(patch) =>
              setSettings({ ...settings, ...patch })
            }
            onToggle={() => toggleSection("anomalyDetector")}
          />

          {/* Watch & Move Section */}
          <Card className="border border-content2">
            <CardHeader
              className="cursor-pointer hover:bg-content2/50 transition-colors"
              onClick={() => toggleSection("downloadWatcher")}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  <FolderInput className="text-secondary" size={24} />
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold">Watch & Move</h2>
                      <Chip color="secondary" size="sm" variant="flat">
                        DOWNLOAD → LIBRARY
                      </Chip>
                    </div>
                    <p className="text-sm text-default-500">
                      Find finished downloads in your client folders and move
                      them into the library (rename optional)
                    </p>
                  </div>
                </div>
                {expandedSections.has("downloadWatcher") ? (
                  <ChevronDown size={20} />
                ) : (
                  <ChevronRight size={20} />
                )}
              </div>
            </CardHeader>
            {expandedSections.has("downloadWatcher") && (
              <CardBody className="pt-0 space-y-6">
                <SectionInfoCallout>
                  Choose saved folders from Media Directories above, or pick
                  custom paths. Enable automatic watch & move to poll on a
                  schedule, or use Scan now for a one-time pass. Naming settings
                  live under Movie / Series File Naming.
                </SectionInfoCallout>

                {/* Movies Row */}
                <div
                  className={`p-4 rounded-xl border border-secondary/30 bg-secondary/5 space-y-4 ${
                    settings.movieWatcherEnabled === false ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Film className="text-secondary" size={20} />
                      <div>
                        <h3 className="font-semibold text-secondary">Movies</h3>
                        <p className="text-xs text-default-500">
                          Move completed movie downloads into the library
                        </p>
                      </div>
                    </div>
                    <Switch
                      color="secondary"
                      isSelected={settings.movieWatcherEnabled !== false}
                      onValueChange={(checked) =>
                        setSettings({
                          ...settings,
                          movieWatcherEnabled: checked,
                        })
                      }
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-start">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Download className="text-default-400" size={14} />
                        <span className="text-xs font-medium text-default-500">
                          Download folder
                        </span>
                      </div>
                      <select
                        className={selectFieldClass}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            movieWatcherDownloadMode: e.target.value as
                              | "saved"
                              | "custom",
                          })
                        }
                        value={settings.movieWatcherDownloadMode || "saved"}
                      >
                        <option value="saved">
                          Saved
                          {settings.movieDownloadDirectory
                            ? `: ${truncatePath(settings.movieDownloadDirectory)}`
                            : " (set in Media Directories)"}
                        </option>
                        <option value="custom">Custom…</option>
                      </select>
                      {settings.movieWatcherDownloadMode === "custom" ? (
                        <>
                          <DirectoryPicker
                            label=""
                            onChange={(path) =>
                              setSettings({
                                ...settings,
                                movieWatcherCustomDownloadDirectory: path,
                              })
                            }
                            placeholder="Custom download folder"
                            value={settings.movieWatcherCustomDownloadDirectory}
                          />
                          <Button
                            color="default"
                            isDisabled={
                              !settings.movieWatcherCustomDownloadDirectory
                            }
                            isLoading={testingMovieDownloadDir}
                            onPress={() =>
                              testDownloadDirectory(
                                "movie",
                                settings.movieWatcherCustomDownloadDirectory,
                              )
                            }
                            size="sm"
                            startContent={
                              !testingMovieDownloadDir && (
                                <RefreshCw size={12} />
                              )
                            }
                            variant="flat"
                          >
                            Test
                          </Button>
                        </>
                      ) : (
                        <p className="text-xs text-default-400 break-all">
                          {settings.movieDownloadDirectory ||
                            "No saved download folder yet"}
                        </p>
                      )}
                    </div>

                    <ArrowRight
                      className="text-secondary flex-shrink-0 hidden md:block mt-8"
                      size={24}
                    />

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <FolderOutput className="text-default-400" size={14} />
                        <span className="text-xs font-medium text-default-500">
                          Media folder
                        </span>
                      </div>
                      <select
                        className={selectFieldClass}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            movieWatcherMediaMode: e.target.value as
                              | "saved"
                              | "custom",
                          })
                        }
                        value={settings.movieWatcherMediaMode || "saved"}
                      >
                        <option value="saved">
                          Saved
                          {settings.movieWatcherDestination
                            ? `: ${truncatePath(settings.movieWatcherDestination)}`
                            : " (set in Media Directories)"}
                        </option>
                        <option value="custom">Custom…</option>
                      </select>
                      {settings.movieWatcherMediaMode === "custom" ? (
                        <>
                          <DirectoryPicker
                            label=""
                            onChange={(path) =>
                              setSettings({
                                ...settings,
                                movieWatcherCustomMediaDirectory: path,
                              })
                            }
                            placeholder="Custom media folder"
                            value={settings.movieWatcherCustomMediaDirectory}
                          />
                          <Button
                            color="default"
                            isDisabled={
                              !settings.movieWatcherCustomMediaDirectory
                            }
                            isLoading={testingMovieWatcherDest}
                            onPress={() =>
                              testWatcherDestination(
                                "movie",
                                settings.movieWatcherCustomMediaDirectory,
                              )
                            }
                            size="sm"
                            startContent={
                              !testingMovieWatcherDest && (
                                <RefreshCw size={12} />
                              )
                            }
                            variant="flat"
                          >
                            Test
                          </Button>
                        </>
                      ) : (
                        <p className="text-xs text-default-400 break-all">
                          {settings.movieWatcherDestination ||
                            "No saved media folder yet"}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Series Row */}
                <div
                  className={`p-4 rounded-xl border border-secondary/30 bg-secondary/5 space-y-4 ${
                    settings.seriesWatcherEnabled === false ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Tv className="text-secondary" size={20} />
                      <div>
                        <h3 className="font-semibold text-secondary">Series</h3>
                        <p className="text-xs text-default-500">
                          Move completed Series downloads into the library
                        </p>
                      </div>
                    </div>
                    <Switch
                      color="secondary"
                      isSelected={settings.seriesWatcherEnabled !== false}
                      onValueChange={(checked) =>
                        setSettings({
                          ...settings,
                          seriesWatcherEnabled: checked,
                        })
                      }
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-start">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Download className="text-default-400" size={14} />
                        <span className="text-xs font-medium text-default-500">
                          Download folder
                        </span>
                      </div>
                      <select
                        className={selectFieldClass}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            seriesWatcherDownloadMode: e.target.value as
                              | "saved"
                              | "custom",
                          })
                        }
                        value={settings.seriesWatcherDownloadMode || "saved"}
                      >
                        <option value="saved">
                          Saved
                          {settings.seriesDownloadDirectory
                            ? `: ${truncatePath(settings.seriesDownloadDirectory)}`
                            : " (set in Media Directories)"}
                        </option>
                        <option value="custom">Custom…</option>
                      </select>
                      {settings.seriesWatcherDownloadMode === "custom" ? (
                        <>
                          <DirectoryPicker
                            label=""
                            onChange={(path) =>
                              setSettings({
                                ...settings,
                                seriesWatcherCustomDownloadDirectory: path,
                              })
                            }
                            placeholder="Custom download folder"
                            value={settings.seriesWatcherCustomDownloadDirectory}
                          />
                          <Button
                            color="default"
                            isDisabled={
                              !settings.seriesWatcherCustomDownloadDirectory
                            }
                            isLoading={testingSeriesDownloadDir}
                            onPress={() =>
                              testDownloadDirectory(
                                "series",
                                settings.seriesWatcherCustomDownloadDirectory,
                              )
                            }
                            size="sm"
                            startContent={
                              !testingSeriesDownloadDir && (
                                <RefreshCw size={12} />
                              )
                            }
                            variant="flat"
                          >
                            Test
                          </Button>
                        </>
                      ) : (
                        <p className="text-xs text-default-400 break-all">
                          {settings.seriesDownloadDirectory ||
                            "No saved download folder yet"}
                        </p>
                      )}
                    </div>

                    <ArrowRight
                      className="text-secondary flex-shrink-0 hidden md:block mt-8"
                      size={24}
                    />

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <FolderOutput className="text-default-400" size={14} />
                        <span className="text-xs font-medium text-default-500">
                          Media folder
                        </span>
                      </div>
                      <select
                        className={selectFieldClass}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            seriesWatcherMediaMode: e.target.value as
                              | "saved"
                              | "custom",
                          })
                        }
                        value={settings.seriesWatcherMediaMode || "saved"}
                      >
                        <option value="saved">
                          Saved
                          {settings.seriesWatcherDestination
                            ? `: ${truncatePath(settings.seriesWatcherDestination)}`
                            : " (set in Media Directories)"}
                        </option>
                        <option value="custom">Custom…</option>
                      </select>
                      {settings.seriesWatcherMediaMode === "custom" ? (
                        <>
                          <DirectoryPicker
                            label=""
                            onChange={(path) =>
                              setSettings({
                                ...settings,
                                seriesWatcherCustomMediaDirectory: path,
                              })
                            }
                            placeholder="Custom media folder"
                            value={settings.seriesWatcherCustomMediaDirectory}
                          />
                          <Button
                            color="default"
                            isDisabled={
                              !settings.seriesWatcherCustomMediaDirectory
                            }
                            isLoading={testingSeriesWatcherDest}
                            onPress={() =>
                              testWatcherDestination(
                                "series",
                                settings.seriesWatcherCustomMediaDirectory,
                              )
                            }
                            size="sm"
                            startContent={
                              !testingSeriesWatcherDest && (
                                <RefreshCw size={12} />
                              )
                            }
                            variant="flat"
                          >
                            Test
                          </Button>
                        </>
                      ) : (
                        <p className="text-xs text-default-400 break-all">
                          {settings.seriesWatcherDestination ||
                            "No saved media folder yet"}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 p-4 rounded-lg border border-secondary/30 bg-secondary/5">
                  <Button
                    color="secondary"
                    isDisabled={!hasWatcherPathPair}
                    isLoading={previewingWatcher}
                    onPress={previewWatcherMoves}
                    size="sm"
                    startContent={!previewingWatcher && <Eye size={14} />}
                    variant="flat"
                  >
                    Preview moves
                  </Button>
                  <Button
                    color="secondary"
                    isDisabled={!hasWatcherPathPair}
                    isLoading={triggeringWatcher}
                    onPress={triggerWatcherScan}
                    size="sm"
                    startContent={!triggeringWatcher && <RefreshCw size={14} />}
                    variant="solid"
                  >
                    Scan now
                  </Button>
                  <p className="text-xs text-default-500 flex-1 min-w-[12rem]">
                    Preview is a dry run (nothing moves). Scan uses your paths
                    above — they are saved automatically.
                  </p>
                </div>

                <div className="p-4 rounded-lg border border-secondary/30 bg-secondary/5 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-lg ${
                          settings.downloadWatcherEnabled
                            ? "bg-secondary/20"
                            : "bg-content3"
                        }`}
                      >
                        {settings.downloadWatcherEnabled ? (
                          <Zap className="text-secondary" size={18} />
                        ) : (
                          <Pause className="text-default-500" size={18} />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">Automatic watch & move</p>
                        <p className="text-xs text-default-500">
                          {settings.downloadWatcherEnabled
                            ? `Watches download folders, then renames and moves finished files every ${settings.watcherInterval || 30}s`
                            : "Off — use Preview or Scan now when you want a one-time run"}
                        </p>
                      </div>
                    </div>
                    <Switch
                      color="secondary"
                      isSelected={settings.downloadWatcherEnabled}
                      onValueChange={(checked) =>
                        setSettings({
                          ...settings,
                          downloadWatcherEnabled: checked,
                          watcherAutoApprove: checked
                            ? true
                            : settings.watcherAutoApprove,
                        })
                      }
                    />
                  </div>

                  <div className="flex items-center gap-3 pt-1 border-t border-content3">
                    <Clock className="text-secondary flex-shrink-0" size={18} />
                    <div className="flex-1 min-w-0">
                      <label
                        className="text-sm font-medium"
                        htmlFor="watcherInterval"
                      >
                        Check frequency
                      </label>
                      <p className="text-xs text-default-500">
                        Used when automatic watch is on (10–3600 seconds)
                      </p>
                    </div>
                    <Input
                      className="max-w-32"
                      endContent={
                        <span className="text-xs text-default-400">sec</span>
                      }
                      id="watcherInterval"
                      isDisabled={!settings.downloadWatcherEnabled}
                      max="3600"
                      min="10"
                      onChange={(e) => {
                        const value = parseInt(e.target.value) || 30;
                        const clampedValue = Math.max(
                          10,
                          Math.min(3600, value),
                        );
                        setSettings({
                          ...settings,
                          watcherInterval: clampedValue,
                        });
                      }}
                      size="sm"
                      type="number"
                      value={String(settings.watcherInterval || 30)}
                    />
                  </div>

                  {!settings.downloadWatcherEnabled && (
                    <p className="text-xs text-default-500">
                      Scan now still moves matching files immediately (with your
                      naming toggles). Turn this on to poll in the background on
                      a schedule.
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  {/* Pending Files Queue (manual approval) */}
                  {!settings.watcherAutoApprove &&
                      pendingFiles.length > 0 && (
                        <div className="space-y-3 p-4 rounded-lg border border-secondary/30 bg-secondary/5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <List className="text-secondary" size={18} />
                              <span className="font-medium text-secondary">
                                Pending Approval ({pendingFiles.length})
                              </span>
                            </div>
                            <Button
                              color="secondary"
                              onPress={approveAllFiles}
                              size="sm"
                              startContent={<CheckCircle2 size={14} />}
                              variant="flat"
                            >
                              Approve All
                            </Button>
                          </div>

                          <div className="space-y-2 max-h-60 overflow-y-auto">
                            {pendingFiles.map((file) => (
                              <div
                                className="flex items-center justify-between p-3 rounded-lg bg-content2 border border-content3"
                                key={file.id}
                              >
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  {file.type === "movie" ? (
                                    <Film
                                      className="text-secondary flex-shrink-0"
                                      size={18}
                                    />
                                  ) : (
                                    <Tv
                                      className="text-secondary flex-shrink-0"
                                      size={18}
                                    />
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium truncate">
                                      {file.filename}
                                    </p>
                                    <p className="text-xs text-default-400 truncate">
                                      → {file.destinationPath}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex gap-2 flex-shrink-0 ml-2">
                                  <Button
                                    color="secondary"
                                    isIconOnly
                                    isLoading={approvingFile === file.id}
                                    onPress={() => approveFile(file.id)}
                                    size="sm"
                                    variant="flat"
                                  >
                                    <Check size={16} />
                                  </Button>
                                  <Button
                                    color="danger"
                                    isIconOnly
                                    isLoading={rejectingFile === file.id}
                                    onPress={() => rejectFile(file.id)}
                                    size="sm"
                                    variant="flat"
                                  >
                                    <Ban size={16} />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                  {!settings.watcherAutoApprove && pendingFiles.length === 0 && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-content2 border border-content3">
                      <FileCheck className="text-default-400" size={16} />
                      <span className="text-sm text-default-500">
                        No files pending approval
                      </span>
                    </div>
                  )}

                  <div className="pt-2 border-t border-content3">
                    <ActivityLogPanel
                      category="watch_and_move"
                      defaultLimit={25}
                      description="Moves, scans, approvals, and errors — stored permanently."
                      emptyMessage="No Watch & Move activity yet. Run Scan now or enable automatic watch."
                      refreshToken={watchMoveLogRefresh}
                      title="Activity log"
                    />
                  </div>
                </div>
              </CardBody>
            )}
          </Card>

          {/* Movie Naming Section */}
          <Card className="border border-content2">
            <CardHeader
              className="cursor-pointer hover:bg-content2/50 transition-colors"
              onClick={() => toggleSection("movieNaming")}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  <Film className="text-secondary" size={24} />
                  <div>
                    <h2 className="text-lg font-semibold">Movie File Naming</h2>
                    <p className="text-sm text-default-500">
                      Format, scan folder, download naming toggles, and preview
                    </p>
                  </div>
                </div>
                {expandedSections.has("movieNaming") ? (
                  <ChevronDown size={20} />
                ) : (
                  <ChevronRight size={20} />
                )}
              </div>
            </CardHeader>
            {expandedSections.has("movieNaming") && (
              <CardBody className="pt-0 space-y-4">
                <Input
                  classNames={{
                    input: "font-mono text-sm",
                  }}
                  id="movieFileFormat"
                  label="Movie File Format"
                  onChange={(e) => {
                    syncFormatInputSelection(e, movieFormatSelection);
                    setSettings({
                      ...settings,
                      movieFileFormat: e.target.value,
                    });
                  }}
                  onClick={(e) =>
                    syncFormatInputSelection(e, movieFormatSelection)
                  }
                  onSelect={(e) =>
                    syncFormatInputSelection(e, movieFormatSelection)
                  }
                  placeholder="{Movie Title} ({Release Year})"
                  value={settings.movieFileFormat}
                  variant="bordered"
                />
                <FormatTokenChips
                  onInsert={(token) =>
                    insertFormatToken(
                      "movieFileFormat",
                      token,
                      movieFormatSelection,
                      "movieFileFormat",
                    )
                  }
                  tokens={MOVIE_FORMAT_TOKENS}
                />

                <div className="space-y-2 p-4 rounded-lg border border-content3">
                  <label className="text-sm font-medium">
                    Folder to scan for preview & rename
                  </label>
                  <select
                    className={selectFieldClass}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        movieNamingScanTarget: e.target.value as
                          | "media"
                          | "download",
                      })
                    }
                    value={settings.movieNamingScanTarget || "media"}
                  >
                    <option value="media">
                      Media folder (from Media Directories)
                    </option>
                    <option value="download">
                      Download folder (from Media Directories)
                    </option>
                  </select>
                  <p className="text-xs text-default-400 break-all">
                    {movieNamingScanPath() ||
                      "No path set — configure Media Directories above"}
                  </p>
                </div>

                <div className="p-3 rounded-lg border border-content3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        Subfolder per movie
                      </p>
                      <p className="text-xs text-default-500">
                        {settings.movieNamingUseFolders
                          ? "Creates a folder matching the movie name, with the video file inside."
                          : "Places one renamed file in the scan folder (release folders are removed only if empty, unless cleanup below is on)."}
                      </p>
                    </div>
                    <Switch
                      color="secondary"
                      isSelected={settings.movieNamingUseFolders === true}
                      onValueChange={(checked) =>
                        setSettings({
                          ...settings,
                          movieNamingUseFolders: checked,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-1 border-t border-content3">
                    <div>
                      <p className="text-sm font-medium">
                        Delete leftover release junk
                      </p>
                      <p className="text-xs text-default-500">
                        After a movie is renamed/moved out of a subfolder, delete
                        everything left in that folder (samples, .txt, .nfo,
                        subs, etc.) and remove the folder. Only applies to
                        folders inside your movie scan path — never the scan
                        root itself.
                      </p>
                    </div>
                    <Switch
                      color="secondary"
                      isSelected={
                        settings.movieRenameCleanupReleaseFolder === true
                      }
                      onValueChange={(checked) =>
                        setSettings({
                          ...settings,
                          movieRenameCleanupReleaseFolder: checked,
                        })
                      }
                    />
                  </div>
                  <div className="rounded-md bg-content2 p-2.5 space-y-1">
                    <p className="text-xs font-medium text-default-500">
                      Example after rename
                    </p>
                    <p className="text-xs font-mono text-secondary break-all">
                      {movieNamingLayoutExample()}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg border border-content3">
                    <div>
                      <p className="text-sm font-medium">
                        Apply naming when approving downloads
                      </p>
                      <p className="text-xs text-default-500">
                        Movie downloads use this format on approve
                      </p>
                    </div>
                    <Switch
                      color="secondary"
                      isSelected={
                        settings.movieApplyNamingOnWatcherApprove ?? true
                      }
                      onValueChange={(checked) =>
                        setSettings({
                          ...settings,
                          movieApplyNamingOnWatcherApprove: checked,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border border-content3">
                    <div>
                      <p className="text-sm font-medium">
                        Apply naming on auto-move
                      </p>
                      <p className="text-xs text-default-500">
                        When Watch & Move auto-moves movies
                      </p>
                    </div>
                    <Switch
                      color="secondary"
                      isSelected={
                        settings.movieApplyNamingOnAutomaticMove ?? false
                      }
                      onValueChange={(checked) =>
                        setSettings({
                          ...settings,
                          movieApplyNamingOnAutomaticMove: checked,
                        })
                      }
                    />
                  </div>
                </div>

                {/* Quick Templates */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Quick Templates</h4>
                  <div className="grid gap-2">
                    {[
                      {
                        format: "{Movie Title} ({Release Year})",
                      },
                      {
                        format: "{Movie Title} ({Release Year}) [{Quality}]",
                      },
                      {
                        format:
                          "{Movie Title} ({Release Year}) {Quality} {Source} {Codec}",
                      },
                      {
                        format:
                          "{Movie Title}.{Release Year}.{Quality}.{Codec}-{Release Group}",
                      },
                    ].map(({ format }) => {
                      const example = `${applyMovieFormatTokensToSample(format)}.${FILE_NAMING_EXAMPLES.ext}`;
                      return (
                        <button
                          className="flex justify-between items-center p-3 rounded-lg border border-content3 hover:border-secondary hover:bg-secondary/5 transition-all text-left"
                          key={format}
                          onClick={() =>
                            setSettings({ ...settings, movieFileFormat: format })
                          }
                          type="button"
                        >
                          <code className="text-xs text-secondary">{format}</code>
                          <span className="text-xs text-default-500 ml-2">
                            → {example}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-4 border-t border-content3">
                  <Button
                    className="w-full sm:w-auto"
                    color="secondary"
                    isDisabled={!movieNamingScanPath()}
                    isLoading={loadingPreview && renameType === "movies"}
                    onPress={() => previewRenames("movies")}
                    startContent={
                      !(loadingPreview && renameType === "movies") && (
                        <Eye size={16} />
                      )
                    }
                    variant="flat"
                  >
                    Preview movie changes
                  </Button>
                </div>

                {renderRenameBatchProgress("movies")}

                <div className="p-3 rounded-lg border border-content3">
                  <ActivityLogPanel
                    actionPrefix="movie_"
                    category="file_rename"
                    description="Each movie rename and batch run — expand a row for full paths."
                    refreshToken={activityLogRefresh}
                    title="Rename history"
                  />
                </div>
              </CardBody>
            )}
          </Card>

          {/* Series Naming Section */}
          <Card className="border border-content2">
            <CardHeader
              className="cursor-pointer hover:bg-content2/50 transition-colors"
              onClick={() => toggleSection("seriesNaming")}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  <Tv className="text-secondary" size={24} />
                  <div>
                    <h2 className="text-lg font-semibold">
                      Series File Naming
                    </h2>
                    <p className="text-sm text-default-500">
                      Format, scan folder, download naming toggles, and preview
                    </p>
                  </div>
                </div>
                {expandedSections.has("seriesNaming") ? (
                  <ChevronDown size={20} />
                ) : (
                  <ChevronRight size={20} />
                )}
              </div>
            </CardHeader>
            {expandedSections.has("seriesNaming") && (
              <CardBody className="pt-0 space-y-4">
                <Input
                  classNames={{
                    input: "font-mono text-sm",
                  }}
                  id="seriesFileFormat"
                  label="Series File Format"
                  onChange={(e) => {
                    syncFormatInputSelection(e, seriesFormatSelection);
                    setSettings({
                      ...settings,
                      seriesFileFormat: e.target.value,
                    });
                  }}
                  onClick={(e) =>
                    syncFormatInputSelection(e, seriesFormatSelection)
                  }
                  onSelect={(e) =>
                    syncFormatInputSelection(e, seriesFormatSelection)
                  }
                  placeholder="{Series Title}/Season {season:00}/{Series Title} - S{season:00}E{episode:00} - {Episode Title}"
                  value={settings.seriesFileFormat}
                  variant="bordered"
                />
                <FormatTokenChips
                  onInsert={(token) =>
                    insertFormatToken(
                      "seriesFileFormat",
                      token,
                      seriesFormatSelection,
                      "seriesFileFormat",
                    )
                  }
                  tokens={SERIES_FORMAT_TOKENS}
                />

                <div className="space-y-2 p-4 rounded-lg border border-content3">
                  <label className="text-sm font-medium">
                    Folder to scan for preview & rename
                  </label>
                  <select
                    className={selectFieldClass}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        seriesNamingScanTarget: e.target.value as
                          | "media"
                          | "download",
                      })
                    }
                    value={settings.seriesNamingScanTarget || "media"}
                  >
                    <option value="media">
                      Media folder (from Media Directories)
                    </option>
                    <option value="download">
                      Download folder (from Media Directories)
                    </option>
                  </select>
                  <p className="text-xs text-default-400 break-all">
                    {seriesNamingScanPath() ||
                      "No path set — configure Media Directories above"}
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg border border-content3">
                    <div>
                      <p className="text-sm font-medium">
                        Apply naming when approving downloads
                      </p>
                      <p className="text-xs text-default-500">
                        Series downloads use this format on approve
                      </p>
                    </div>
                    <Switch
                      color="secondary"
                      isSelected={
                        settings.seriesApplyNamingOnWatcherApprove ?? true
                      }
                      onValueChange={(checked) =>
                        setSettings({
                          ...settings,
                          seriesApplyNamingOnWatcherApprove: checked,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border border-content3">
                    <div>
                      <p className="text-sm font-medium">
                        Apply naming on auto-move
                      </p>
                      <p className="text-xs text-default-500">
                        When Watch & Move auto-moves Series
                      </p>
                    </div>
                    <Switch
                      color="secondary"
                      isSelected={
                        settings.seriesApplyNamingOnAutomaticMove ?? false
                      }
                      onValueChange={(checked) =>
                        setSettings({
                          ...settings,
                          seriesApplyNamingOnAutomaticMove: checked,
                        })
                      }
                    />
                  </div>
                </div>

                {/* Quick Templates */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Quick Templates</h4>
                  <div className="grid gap-2">
                    {[
                      {
                        format:
                          "{Series Title} - S{season:00}E{episode:00} - {Episode Title}",
                      },
                      {
                        format:
                          "{Series Title}/Season {season:00}/{Series Title} - S{season:00}E{episode:00}",
                      },
                      {
                        format:
                          "{Series Title}.S{season:00}E{episode:00}.{Quality}.{Codec}",
                      },
                    ].map(({ format }) => {
                      const s = FILE_NAMING_EXAMPLES;
                      let example: string;
                      if (format.includes("/")) {
                        example = `${s.seriesTitle}/Season ${s.seasonPadded}/${s.seriesTitle} - S${s.seasonPadded}E${s.episodePadded}.${s.ext}`;
                      } else if (format.includes(".S{")) {
                        example = `${s.seriesTitle.replace(/ /g, ".")}.S${s.seasonPadded}E${s.episodePadded}.${s.quality}.${s.codec}.${s.ext}`;
                      } else {
                        example = `${applySeriesFormatTokensToSample(format)}.${s.ext}`;
                      }
                      return (
                        <button
                          className="flex justify-between items-center p-3 rounded-lg border border-content3 hover:border-secondary hover:bg-secondary/5 transition-all text-left"
                          key={format}
                          onClick={() =>
                            setSettings({ ...settings, seriesFileFormat: format })
                          }
                          type="button"
                        >
                          <code className="text-xs text-secondary">{format}</code>
                          <span className="text-xs text-default-500 ml-2">
                            → {example}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-4 border-t border-content3">
                  <Button
                    className="w-full sm:w-auto"
                    color="secondary"
                    isDisabled={!seriesNamingScanPath()}
                    isLoading={loadingPreview && renameType === "series"}
                    onPress={() => previewRenames("series")}
                    startContent={
                      !(loadingPreview && renameType === "series") && (
                        <Eye size={16} />
                      )
                    }
                    variant="flat"
                  >
                    Preview Series changes
                  </Button>
                </div>

                {renderRenameBatchProgress("series")}

                <div className="p-3 rounded-lg border border-content3">
                  <ActivityLogPanel
                    actionPrefix="series_"
                    category="file_rename"
                    description="Each Series episode rename and batch run — expand a row for full paths."
                    refreshToken={activityLogRefresh}
                    title="Rename history"
                  />
                </div>
              </CardBody>
            )}
          </Card>
        </div>
      </PageContent>

      {/* Rename Preview Modal */}
      <Modal
        isOpen={showRenameModal}
        onClose={() => {
          setShowRenameModal(false);
          setRenamePreviewSearch("");
        }}
        scrollBehavior="inside"
        size="4xl"
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Pencil size={20} />
            Preview File Renames
            <Chip
              color="secondary"
              size="sm"
            >
              {renameType === "movies" ? "Movies" : "Series"}
            </Chip>
          </ModalHeader>
          <ModalBody>
            {renamePreview.length === 0 ? (
              <div className="text-center py-8 space-y-3">
                {(() => {
                  const s =
                    renameType === "movies"
                      ? renamePreviewStats.movies
                      : renamePreviewStats.series;
                  const scanned = s?.scanned ?? 0;
                  const matched = s?.matched ?? 0;
                  const already = s?.alreadyNamed ?? 0;
                  const skipped = (s?.skipped as RenamePreviewStats["skipped"]) ?? [];
                  const unparseable = skipped.filter(
                    (x) => x.reason === "cant_parse_title",
                  ).length;

                  if (scanned === 0) {
                    return (
                      <>
                        <Info className="mx-auto mb-4 text-default-400" size={48} />
                        <p className="text-lg font-medium">No video files found</p>
                        <p className="text-default-500 text-sm">
                          Check your scan folder (media vs download) and that
                          release folders contain video files.
                        </p>
                      </>
                    );
                  }

                  if (matched === 0 && unparseable > 0) {
                    return (
                      <>
                        <AlertTriangle className="mx-auto mb-4 text-secondary" size={48} />
                        <p className="text-lg font-medium">
                          Could not read a title from these files
                        </p>
                        <p className="text-default-500 text-sm max-w-md mx-auto">
                          Scanned {scanned} file(s). Release folder or filename
                          needs a recognizable title and year (e.g.{" "}
                          <code className="text-xs">The.Death.of.Stalin.2017.720p</code>
                          ).
                        </p>
                      </>
                    );
                  }

                  if (already > 0 && matched === already) {
                    return (
                      <>
                        <Check className="mx-auto mb-4 text-secondary" size={48} />
                        <p className="text-lg font-medium">
                          All matched files already use your naming format
                        </p>
                        <p className="text-default-500 text-sm">
                          Scanned {scanned}, matched {matched}, already correct{" "}
                          {already}.
                        </p>
                      </>
                    );
                  }

                  return (
                    <>
                      <Info className="mx-auto mb-4 text-secondary" size={48} />
                      <p className="text-lg font-medium">Nothing to rename</p>
                      <p className="text-default-500 text-sm">
                        Scanned {scanned}, matched {matched}, skipped{" "}
                        {skipped.length}.
                      </p>
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="space-y-4">
                <SectionInfoCallout>
                  <p className="font-medium">
                    {renamePreview.length} file(s) will be renamed
                  </p>
                  <p className="mt-1">
                    {renamePreview.filter((r) => r.type === "movie").length}{" "}
                    movies,{" "}
                    {renamePreview.filter((r) => r.type === "series").length}{" "}
                    Series episodes
                    {renamePreview.some((r) => r.needsReview) ? (
                      <span className="text-danger block mt-1">
                        {renamePreview.filter((r) => r.needsReview).length}{" "}
                        flagged for review (highlighted in red)
                      </span>
                    ) : null}
                  </p>
                </SectionInfoCallout>

                <Input
                  aria-label="Search rename preview"
                  classNames={{ inputWrapper: "bg-content1" }}
                  onValueChange={setRenamePreviewSearch}
                  placeholder="Search filenames, paths, resolved titles…"
                  size="sm"
                  startContent={
                    <Search className="text-default-400" size={16} />
                  }
                  value={renamePreviewSearch}
                  variant="bordered"
                  isClearable
                  onClear={() => setRenamePreviewSearch("")}
                />
                {renamePreviewSearch.trim() ? (
                  <p className="text-xs text-default-500 -mt-2">
                    Showing {filteredRenamePreview.length} of{" "}
                    {renamePreview.length} file
                    {renamePreview.length === 1 ? "" : "s"}
                    {filteredRenamePreview.length === 0
                      ? " — try a different search"
                      : ""}
                  </p>
                ) : null}

                {/* Movies */}
                {filteredRenamePreview.filter((r) => r.type === "movie")
                  .length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold flex items-center gap-2">
                      <Film className="text-secondary" size={16} />
                      Movies
                      {renamePreviewSearch.trim() ? (
                        <span className="text-xs font-normal text-default-400">
                          (
                          {
                            filteredRenamePreview.filter(
                              (r) => r.type === "movie",
                            ).length
                          }
                          )
                        </span>
                      ) : null}
                    </h4>
                    {filteredRenamePreview
                      .filter((r) => r.type === "movie")
                      .map((item) => (
                        <div
                          className={`p-3 rounded-lg border space-y-3 min-w-0 overflow-hidden ${
                            item.needsReview
                              ? "border-danger bg-danger/10"
                              : "border-content3"
                          }`}
                          key={item.currentPath}
                        >
                          {item.needsReview && item.reviewReasons?.length ? (
                            <div className="flex flex-wrap gap-2">
                              {item.reviewReasons.map((reason) => (
                                <Chip
                                  color="danger"
                                  key={reason}
                                  size="sm"
                                  variant="flat"
                                >
                                  {RENAME_REVIEW_LABELS[reason] || reason}
                                </Chip>
                              ))}
                            </div>
                          ) : null}
                          <div className="flex flex-wrap items-center gap-2">
                            {item.resolvedTitle ? (
                              <p className="text-xs text-default-500">
                                Resolved as:{" "}
                                <span className="font-medium text-foreground">
                                  {item.resolvedTitle}
                                </span>
                                {item.matchSource ? ` (${item.matchSource})` : ""}
                                {item.tmdbId ? ` · TMDB ${item.tmdbId}` : ""}
                              </p>
                            ) : null}
                            <Button
                              isDisabled={applyingTmdb}
                              onPress={() => setTmdbPickItem(item)}
                              size="sm"
                              variant="bordered"
                            >
                              Change TMDB match
                            </Button>
                          </div>
                          <RenameLocationPreview
                            item={item}
                            needsReview={item.needsReview}
                            onNewNameChange={(value) => {
                              const updated = [...renamePreview];
                              const actualIndex = renamePreview.findIndex(
                                (r) => r === item,
                              );
                              updated[actualIndex].newName = value;
                              setRenamePreview(updated);
                            }}
                          />
                          <div className="flex justify-end gap-2 pt-1">
                            <Button
                              color="secondary"
                              isDisabled={
                                renaming || renamingPath !== null || !item.newName?.trim()
                              }
                              isLoading={renamingPath === item.currentPath}
                              onPress={() => executeSingleRename(item)}
                              size="sm"
                              startContent={
                                renamingPath !== item.currentPath && (
                                  <Check size={14} />
                                )
                              }
                              variant="flat"
                            >
                              Rename this file
                            </Button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}

                {renamePreviewSearch.trim() &&
                filteredRenamePreview.length === 0 ? (
                  <div className="text-center py-10 text-default-500 text-sm">
                    No renames match &ldquo;{renamePreviewSearch.trim()}&rdquo;
                  </div>
                ) : null}

                {/* Series */}
                {filteredRenamePreview.filter((r) => r.type === "series")
                  .length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold flex items-center gap-2">
                      <Tv className="text-secondary" size={16} />
                      Series
                      {renamePreviewSearch.trim() ? (
                        <span className="text-xs font-normal text-default-400">
                          (
                          {
                            filteredRenamePreview.filter(
                              (r) => r.type === "series",
                            ).length
                          }
                          )
                        </span>
                      ) : null}
                    </h4>
                    {filteredRenamePreview
                      .filter((r) => r.type === "series")
                      .map((item) => (
                        <div
                          className="p-3 rounded-lg border border-content3 space-y-3 min-w-0 overflow-hidden"
                          key={item.currentPath}
                        >
                          <RenameLocationPreview
                            item={item}
                            onNewNameChange={(value) => {
                              const updated = [...renamePreview];
                              const actualIndex = renamePreview.findIndex(
                                (r) => r === item,
                              );
                              updated[actualIndex].newName = value;
                              setRenamePreview(updated);
                            }}
                          />
                          <div className="flex justify-end gap-2 pt-1">
                            <Button
                              color="secondary"
                              isDisabled={
                                renaming || renamingPath !== null || !item.newName?.trim()
                              }
                              isLoading={renamingPath === item.currentPath}
                              onPress={() => executeSingleRename(item)}
                              size="sm"
                              startContent={
                                renamingPath !== item.currentPath && (
                                  <Check size={14} />
                                )
                              }
                              variant="flat"
                            >
                              Rename this file
                            </Button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </ModalBody>
          <ModalFooter className="flex flex-wrap gap-2 justify-end">
            <Button onPress={() => setShowRenameModal(false)} variant="light">
              Cancel
            </Button>
            {renamePreview.length > 0 && (
              <>
                <Button
                  color="secondary"
                  isDisabled={
                    renamingPath !== null ||
                    renaming ||
                    renamePreviewNoConflictCount === 0
                  }
                  isLoading={renaming}
                  onPress={executeRenamesWithoutConflict}
                  variant="flat"
                >
                  Rename with no conflict ({renamePreviewNoConflictCount})
                </Button>
                <Button
                  color="secondary"
                  isDisabled={renamingPath !== null}
                  isLoading={renaming}
                  onPress={executeRenames}
                  startContent={!renaming && <Check size={18} />}
                >
                  Rename all ({renamePreview.length})
                </Button>
              </>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>

      <RenameTmdbPickerModal
        fileLabel={tmdbPickItem?.currentName}
        initialQuery={
          tmdbPickItem?.resolvedTitle ||
          tmdbPickItem?.currentName.replace(/\.[^.]+$/, "") ||
          ""
        }
        isOpen={tmdbPickItem !== null}
        onClose={() => setTmdbPickItem(null)}
        onSelect={(pick) => {
          if (tmdbPickItem) void applyManualTmdbMatch(tmdbPickItem, pick);
        }}
      />

      <Modal
        isOpen={watcherPreviewOpen}
        onClose={() => setWatcherPreviewOpen(false)}
        scrollBehavior="inside"
        size="2xl"
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Eye className="text-secondary" size={20} />
            Preview moves (dry run)
          </ModalHeader>
          <ModalBody className="gap-4">
            <p className="text-sm text-default-500">{watcherPreviewMessage}</p>
            <p className="text-xs text-default-400">
              Mode:{" "}
              {watcherPreviewAutoApprove
                ? "Auto-move — items below would be moved immediately on Scan now"
                : "Manual — Scan now would add these to the approval queue"}
            </p>

            {watcherPreviewReady.length === 0 ? (
              <div className="p-4 rounded-lg bg-content2 text-sm text-default-500">
                Nothing ready to move right now.
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {watcherPreviewReady.map((item, idx) => (
                  <div
                    className="p-3 rounded-lg border border-content3 bg-content2 text-sm"
                    key={`${item.sourcePath}-${idx}`}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      {item.type === "movie" ? (
                        <Film className="text-secondary" size={16} />
                      ) : (
                        <Tv className="text-secondary" size={16} />
                      )}
                      <span className="truncate">{item.name}</span>
                      {item.kind === "folder" && item.fileCount != null && (
                        <Chip size="sm" variant="flat">
                          {item.fileCount} files
                        </Chip>
                      )}
                    </div>
                    <p className="text-xs text-default-400 mt-1 truncate">
                      From: {item.sourcePath}
                    </p>
                    {item.destinationPath && (
                      <p className="text-xs text-default-500 truncate">
                        → {item.destinationPath}
                        {item.size != null && ` (${formatBytes(item.size)})`}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {watcherPreviewSkipped.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-secondary">
                  Skipped ({watcherPreviewSkipped.length})
                </p>
                <div className="space-y-1 max-h-40 overflow-y-auto text-xs text-default-500">
                  {watcherPreviewSkipped.map((item, idx) => (
                    <div
                      className="p-2 rounded-lg bg-secondary/5 border border-secondary/20"
                      key={`skip-${idx}`}
                    >
                      <span className="font-medium">{item.name}</span>
                      {": "}
                      {skipReasonLabel(item.reason)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              onPress={() => setWatcherPreviewOpen(false)}
              variant="light"
            >
              Close
            </Button>
            <Button
              color="secondary"
              isDisabled={!hasWatcherPathPair}
              isLoading={triggeringWatcher}
              onPress={async () => {
                setWatcherPreviewOpen(false);
                await triggerWatcherScan();
              }}
              startContent={!triggeringWatcher && <RefreshCw size={14} />}
            >
              Run scan now
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Info Modal */}
      <Modal
        isOpen={infoModal.isOpen}
        onClose={() => setInfoModal({ ...infoModal, isOpen: false })}
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            {infoModal.type === "success" && (
              <Check className="text-secondary" size={20} />
            )}
            {infoModal.type === "error" && (
              <X className="text-danger" size={20} />
            )}
            {infoModal.type === "warning" && (
              <AlertTriangle className="text-secondary" size={20} />
            )}
            {infoModal.type === "info" && (
              <Info className="text-secondary" size={20} />
            )}
            {infoModal.title}
          </ModalHeader>
          <ModalBody>
            <p className="whitespace-pre-wrap">{infoModal.message}</p>
          </ModalBody>
          <ModalFooter>
            <Button
              color="secondary"
              onPress={() => setInfoModal({ ...infoModal, isOpen: false })}
            >
              OK
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Confirm Modal */}
      <Modal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <AlertTriangle className="text-secondary" size={20} />
            {confirmModal.title}
          </ModalHeader>
          <ModalBody>
            <p className="whitespace-pre-wrap">{confirmModal.message}</p>
          </ModalBody>
          <ModalFooter>
            <Button
              onPress={() =>
                setConfirmModal({ ...confirmModal, isOpen: false })
              }
              variant="light"
            >
              Cancel
            </Button>
            <Button color="secondary" onPress={confirmModal.onConfirm}>
              Confirm
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
};

export default FileManagement;
