"use client";

import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
import axios from "axios";
import { Button, Card, CardBody, CardHeader, Chip, Input, Switch } from "@heroui/react";
import { YLogoLoader } from "@/components/YLogoLoader";
import {
  ChevronDown,
  ChevronRight,
  ScanSearch,
  Trash2,
  Film,
  CheckCircle2,
  AlertTriangle,
  Info,
  FolderOpen,
  HardDrive,
  Clock,
  Activity,
} from "lucide-react";
import { SectionInfoCallout } from "./SectionInfoCallout";
import { ActivityLogPanel } from "./ActivityLogPanel";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/react";
import DirectoryPicker from "./DirectoryPicker";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3013";

const selectFieldClass =
  "w-full rounded-lg border border-content3 bg-content1 px-3 py-2 text-sm";

function truncatePath(path: string | null, max = 52) {
  if (!path) return "";
  if (path.length <= max) return path;
  const head = Math.floor((max - 1) / 2);
  const tail = max - 1 - head;
  return `${path.slice(0, head)}…${path.slice(-tail)}`;
}

export interface AnomalyMediaDirs {
  movieDownload: string | null;
  movieMedia: string | null;
  seriesDownload: string | null;
  seriesMedia: string | null;
}

type SavedDirKey =
  | "movieMedia"
  | "movieDownload"
  | "seriesMedia"
  | "seriesDownload";

interface MediaFileEntry {
  path: string;
  fileName: string;
  size: number;
  sizeFormatted: string;
  lastModified?: string;
}

type DuplicateFile = MediaFileEntry;

interface CorruptFile extends MediaFileEntry {
  type: "corrupt_file";
  reason: string;
  reasonLabel: string;
  detail?: string;
}

interface LargeFile extends MediaFileEntry {
  type: "large_file";
  thresholdBytes: number;
  probeOk: boolean;
  durationFormatted?: string;
  bitrateMbps?: number | null;
  quality?: string;
  videoCodec?: string;
  width?: number | null;
  height?: number | null;
  audioTrackCount?: number;
  subtitleTrackCount?: number;
  streamCount?: number;
  explanations: string[];
  probeError?: string | null;
}

interface DuplicateAnomaly {
  type: "duplicate_movie";
  key: string;
  title: string;
  year: number | null;
  tmdbId: number | null;
  files: DuplicateFile[];
}

export interface AnomalyDetectorPrefs {
  anomalyDetectorAutoScanEnabled: boolean;
  anomalyDetectorScanInterval: number;
  anomalyDetectorScanDirKey: SavedDirKey | "custom";
  anomalyDetectorCustomScanPath: string | null;
  anomalyDetectorCheckDuplicates: boolean;
  anomalyDetectorCheckCorruption: boolean;
  anomalyDetectorCheckLargeFiles: boolean;
}

interface AnomalySchedulerStatus {
  isScheduled: boolean;
  scanInProgress: boolean;
  cancelRequested?: boolean;
  lastRun: string | null;
  lastError: string | null;
}

interface ScanResult {
  scannedAt: string;
  mediaDirectory: string;
  mediaType: string;
  anomalies: DuplicateAnomaly[];
  corruptFiles: CorruptFile[];
  largeFiles: LargeFile[];
  summary: {
    filesScanned: number;
    duplicateGroups: number;
    duplicateFiles: number;
    corruptedFiles: number;
    largeFiles: number;
    largeFileThresholdBytes: number;
    ffprobeAvailable: boolean | null;
  };
}

interface AnomalyDetectorPanelProps {
  mediaDirs: AnomalyMediaDirs;
  anomalyPrefs: AnomalyDetectorPrefs;
  onAnomalyPrefsChange: (patch: Partial<AnomalyDetectorPrefs>) => void;
  expanded: boolean;
  onToggle: () => void;
}

const SAVED_DIR_LABELS: Record<SavedDirKey, string> = {
  movieMedia: "Movies — media folder",
  movieDownload: "Movies — download folder",
  seriesMedia: "TV — media folder",
  seriesDownload: "TV — download folder",
};

export function AnomalyDetectorPanel({
  mediaDirs,
  anomalyPrefs,
  onAnomalyPrefsChange,
  expanded,
  onToggle,
}: AnomalyDetectorPanelProps) {
  const dirMode = anomalyPrefs.anomalyDetectorScanDirKey;
  const customPath = anomalyPrefs.anomalyDetectorCustomScanPath;
  const checkDuplicates = anomalyPrefs.anomalyDetectorCheckDuplicates;
  const checkCorruption = anomalyPrefs.anomalyDetectorCheckCorruption;
  const checkLargeFiles = anomalyPrefs.anomalyDetectorCheckLargeFiles;
  const [scanning, setScanning] = useState(false);
  const [cancellingScan, setCancellingScan] = useState(false);
  const [activityLogRefresh, setActivityLogRefresh] = useState(0);
  const [schedulerStatus, setSchedulerStatus] =
    useState<AnomalySchedulerStatus | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MediaFileEntry | null>(
    null,
  );

  const savedOptions = useMemo(
    () =>
      (Object.keys(SAVED_DIR_LABELS) as SavedDirKey[]).filter(
        (key) => Boolean(mediaDirs[key]),
      ),
    [mediaDirs],
  );

  const effectiveDirectory = useMemo(() => {
    if (dirMode === "custom") return customPath;
    return mediaDirs[dirMode] ?? null;
  }, [dirMode, customPath, mediaDirs]);

  const fetchSchedulerStatus = useCallback(async () => {
    try {
      const token = localStorage.getItem("accessToken");
      const { data } = await axios.get<
        AnomalySchedulerStatus & { success: boolean }
      >(`${API_BASE_URL}/api/Settings/anomaly-detector/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSchedulerStatus(data);
    } catch {
      /* ignore poll errors */
    }
  }, []);

  const autoScanRunning = Boolean(schedulerStatus?.scanInProgress);
  const wasAutoScanRunning = useRef(false);

  useEffect(() => {
    if (wasAutoScanRunning.current && !autoScanRunning) {
      setActivityLogRefresh((n) => n + 1);
    }
    wasAutoScanRunning.current = autoScanRunning;
  }, [autoScanRunning]);

  useEffect(() => {
    if (!expanded) return;
    void fetchSchedulerStatus();
    const pollMs = autoScanRunning ? 2000 : 10000;
    const id = setInterval(() => void fetchSchedulerStatus(), pollMs);
    return () => clearInterval(id);
  }, [expanded, fetchSchedulerStatus, autoScanRunning]);

  const canAutoScan =
    Boolean(effectiveDirectory) &&
    (checkDuplicates || checkCorruption || checkLargeFiles);

  const cancelScheduledScan = useCallback(async () => {
    setCancellingScan(true);
    try {
      const token = localStorage.getItem("accessToken");
      await axios.post(
        `${API_BASE_URL}/api/Settings/anomaly-detector/cancel`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      await fetchSchedulerStatus();
      setActivityLogRefresh((n) => n + 1);
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : "Could not cancel the scan.";
      setScanError(message);
    } finally {
      setCancellingScan(false);
    }
  }, [fetchSchedulerStatus]);

  const runScan = useCallback(async () => {
    if (autoScanRunning) {
      setScanError(
        "An automatic scan is already running. Cancel it or wait for it to finish.",
      );
      return;
    }
    if (!effectiveDirectory) {
      setScanError("Choose a folder to scan (saved path or custom).");
      return;
    }
    if (!checkDuplicates && !checkCorruption && !checkLargeFiles) {
      setScanError(
        "Enable at least one check: duplicates, corruption, or large files.",
      );
      return;
    }

    setScanning(true);
    setScanError(null);

    try {
      const token = localStorage.getItem("accessToken");
      const { data } = await axios.post<ScanResult & { success: boolean }>(
        `${API_BASE_URL}/api/Settings/anomaly-detector/scan`,
        {
          mediaType: "movie",
          directoryPath: effectiveDirectory,
          checkDuplicates,
          checkCorruption,
          checkLargeFiles,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setScanResult({
        ...data,
        corruptFiles: data.corruptFiles ?? [],
        largeFiles: data.largeFiles ?? [],
      });
      await fetchSchedulerStatus();
      setActivityLogRefresh((n) => n + 1);
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : "Scan failed. Check that the API is running and your media path is valid.";
      setScanError(message);
      setScanResult(null);
    } finally {
      setScanning(false);
    }
  }, [
    checkCorruption,
    checkDuplicates,
    checkLargeFiles,
    autoScanRunning,
    effectiveDirectory,
    fetchSchedulerStatus,
  ]);

  const scanNeedsFfprobe = checkCorruption || checkLargeFiles;

  const scanResultEmpty = useMemo(() => {
    if (!scanResult) return false;
    const dupOk = !checkDuplicates || scanResult.anomalies.length === 0;
    const corruptOk = !checkCorruption || scanResult.corruptFiles.length === 0;
    const largeOk = !checkLargeFiles || scanResult.largeFiles.length === 0;
    return dupOk && corruptOk && largeOk;
  }, [checkCorruption, checkDuplicates, checkLargeFiles, scanResult]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setDeletingPath(target.path);

    try {
      const token = localStorage.getItem("accessToken");
      await axios.post(
        `${API_BASE_URL}/api/Settings/anomaly-detector/delete`,
        {
          filePath: target.path,
          scanDirectory: scanResult?.mediaDirectory,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      setScanResult((prev) => {
        if (!prev) return prev;
        const anomalies = prev.anomalies
          .map((group) => ({
            ...group,
            files: group.files.filter((f) => f.path !== target.path),
          }))
          .filter((g) => g.files.length > 1);
        const duplicateFiles = anomalies.reduce(
          (n, g) => n + g.files.length,
          0,
        );
        const corruptFiles = prev.corruptFiles.filter(
          (f) => f.path !== target.path,
        );
        const largeFiles = prev.largeFiles.filter(
          (f) => f.path !== target.path,
        );
        return {
          ...prev,
          anomalies,
          corruptFiles,
          largeFiles,
          summary: {
            ...prev.summary,
            duplicateGroups: anomalies.length,
            duplicateFiles,
            corruptedFiles: corruptFiles.length,
            largeFiles: largeFiles.length,
          },
        };
      });
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : "Could not delete file.";
      setScanError(message);
    } finally {
      setDeletingPath(null);
    }
  };

  return (
    <>
      <Card className="border border-content2">
        <CardHeader
          className="cursor-pointer hover:bg-content2/50 transition-colors"
          onClick={onToggle}
        >
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
              <ScanSearch className="text-secondary" size={24} />
              <div>
                <h2 className="text-lg font-semibold">Anomaly Detector</h2>
                <p className="text-sm text-default-500">
                  Duplicates, corruption, and 10GB+ file analysis
                </p>
              </div>
            </div>
            {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
          </div>
        </CardHeader>

        {expanded && (
          <CardBody className="pt-0 space-y-4">
            <SectionInfoCallout>
              Scan a media folder for duplicate titles, broken files, or
              anything over 10&nbsp;GB (corruption and large-file checks need{" "}
              <code className="text-xs">ffprobe</code> on the server). Pick a
              saved path or a custom folder. Delete actions remove files from
              disk for good.
            </SectionInfoCallout>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-content3 bg-content1">
                <div>
                  <p className="text-sm font-medium">Duplicate media</p>
                  <p className="text-xs text-default-500">
                    Same title with multiple files
                  </p>
                </div>
                <Switch
                  color="secondary"
                  isSelected={checkDuplicates}
                  onValueChange={(checked) =>
                    onAnomalyPrefsChange({
                      anomalyDetectorCheckDuplicates: checked,
                    })
                  }
                />
              </div>
              <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-content3 bg-content1">
                <div>
                  <p className="text-sm font-medium">Corrupted files</p>
                  <p className="text-xs text-default-500">
                    ffprobe integrity per file
                  </p>
                </div>
                <Switch
                  color="secondary"
                  isSelected={checkCorruption}
                  onValueChange={(checked) =>
                    onAnomalyPrefsChange({
                      anomalyDetectorCheckCorruption: checked,
                    })
                  }
                />
              </div>
              <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-content3 bg-content1">
                <div>
                  <p className="text-sm font-medium">Large files (10 GB+)</p>
                  <p className="text-xs text-default-500">
                    ffprobe bitrate and track analysis
                  </p>
                </div>
                <Switch
                  color="secondary"
                  isSelected={checkLargeFiles}
                  onValueChange={(checked) =>
                    onAnomalyPrefsChange({
                      anomalyDetectorCheckLargeFiles: checked,
                    })
                  }
                />
              </div>
            </div>

            <div className="p-4 rounded-xl border border-secondary/30 bg-secondary/5 space-y-3">
              <div className="flex items-center gap-2">
                <FolderOpen className="text-secondary" size={18} />
                <span className="text-sm font-medium">Scan folder</span>
              </div>
              <select
                className={selectFieldClass}
                onChange={(e) => {
                  const key = e.target.value as SavedDirKey | "custom";
                  onAnomalyPrefsChange({ anomalyDetectorScanDirKey: key });
                }}
                value={dirMode}
              >
                {savedOptions.map((key) => (
                  <option key={key} value={key}>
                    {SAVED_DIR_LABELS[key]}:{" "}
                    {truncatePath(mediaDirs[key])}
                  </option>
                ))}
                <option value="custom">Custom folder…</option>
              </select>
              {dirMode === "custom" && (
                <DirectoryPicker
                  label=""
                  onChange={(path) =>
                    onAnomalyPrefsChange({
                      anomalyDetectorCustomScanPath: path,
                    })
                  }
                  placeholder="Pick a folder to scan"
                  value={customPath}
                />
              )}
              {dirMode !== "custom" && effectiveDirectory && (
                <p className="text-xs text-default-400 font-mono break-all">
                  {effectiveDirectory}
                </p>
              )}
            </div>

            <div className="p-4 rounded-lg border border-secondary/30 bg-secondary/5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2 rounded-lg ${
                      anomalyPrefs.anomalyDetectorAutoScanEnabled
                        ? "bg-secondary/20"
                        : "bg-content3"
                    }`}
                  >
                    {anomalyPrefs.anomalyDetectorAutoScanEnabled ? (
                      <Activity className="text-secondary" size={18} />
                    ) : (
                      <Clock className="text-default-500" size={18} />
                    )}
                  </div>
                  <div>
                    <p className="font-medium">Automatic scan</p>
                    <p className="text-xs text-default-500">
                      {anomalyPrefs.anomalyDetectorAutoScanEnabled
                        ? `Runs on a timer using the checks and folder above`
                        : "Off — use Scan library for a one-time run"}
                    </p>
                  </div>
                </div>
                <Switch
                  color="secondary"
                  isDisabled={!canAutoScan}
                  isSelected={anomalyPrefs.anomalyDetectorAutoScanEnabled}
                  onValueChange={(checked) =>
                    onAnomalyPrefsChange({
                      anomalyDetectorAutoScanEnabled: checked,
                    })
                  }
                />
              </div>
              <div className="flex items-center gap-3 pt-1 border-t border-content3">
                <Clock className="text-secondary flex-shrink-0" size={18} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Check frequency</p>
                  <p className="text-xs text-default-500">
                    Seconds between scheduled scans (min 60)
                  </p>
                </div>
                <Input
                  className="max-w-32"
                  endContent={
                    <span className="text-xs text-default-400">sec</span>
                  }
                  isDisabled={!anomalyPrefs.anomalyDetectorAutoScanEnabled}
                  max={86400}
                  min={60}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10) || 1800;
                    const clamped = Math.max(60, Math.min(86400, value));
                    onAnomalyPrefsChange({
                      anomalyDetectorScanInterval: clamped,
                    });
                  }}
                  size="sm"
                  type="number"
                  value={String(anomalyPrefs.anomalyDetectorScanInterval || 1800)}
                />
              </div>
              {!canAutoScan && (
                <p className="text-xs text-default-500">
                  Pick a folder and enable at least one check to use automatic
                  scan.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                color="secondary"
                isDisabled={
                  autoScanRunning ||
                  !effectiveDirectory ||
                  (!checkDuplicates && !checkCorruption && !checkLargeFiles)
                }
                isLoading={scanning}
                onPress={() => void runScan()}
                startContent={!scanning && <ScanSearch size={16} />}
              >
                Scan library
              </Button>
              {autoScanRunning && (
                <Button
                  color="danger"
                  isDisabled={
                    cancellingScan || Boolean(schedulerStatus?.cancelRequested)
                  }
                  isLoading={
                    cancellingScan || Boolean(schedulerStatus?.cancelRequested)
                  }
                  onPress={() => void cancelScheduledScan()}
                  size="sm"
                  variant="flat"
                >
                  Cancel scan
                </Button>
              )}
              {scanResult && !scanning && !autoScanRunning && (
                <Chip color="default" size="sm" variant="flat">
                  {scanResult.summary.filesScanned} file
                  {scanResult.summary.filesScanned === 1 ? "" : "s"} scanned
                </Chip>
              )}
            </div>

            {scanError && (
              <div className="p-3 rounded-lg border border-danger/30 bg-danger/10 text-danger text-sm flex items-center gap-2">
                <AlertTriangle size={16} />
                {scanError}
              </div>
            )}

            {(scanning || autoScanRunning) && (
              <div className="flex items-center gap-3 py-6 justify-center text-default-500">
                <YLogoLoader color="secondary" size="sm" />
                <span>
                  {autoScanRunning && !scanning
                    ? schedulerStatus?.cancelRequested
                      ? "Cancelling automatic scan…"
                      : "Automatic scan in progress…"
                    : checkLargeFiles && checkCorruption
                      ? "Scanning library and running ffprobe…"
                      : checkLargeFiles
                        ? "Finding 10 GB+ files and running ffprobe…"
                        : checkCorruption
                          ? "Running ffprobe integrity checks…"
                          : "Scanning library for duplicate media…"}
                </span>
              </div>
            )}

            {!scanning &&
              !autoScanRunning &&
              scanResult &&
              scanNeedsFfprobe &&
              scanResult.summary.ffprobeAvailable === false && (
                <div className="flex items-center gap-2 p-3 rounded-lg border border-secondary/30 bg-secondary/10 text-secondary text-sm">
                  <AlertTriangle size={16} />
                  <span>
                    ffprobe was not found on the server — corruption and large-file
                    analysis are limited. Install ffmpeg and ensure ffprobe is on
                    PATH.
                  </span>
                </div>
              )}

            {!scanning && scanResult && scanResultEmpty && (
                <div className="flex items-center gap-2 p-4 rounded-lg border border-secondary/30 bg-secondary/10 text-secondary">
                  <CheckCircle2 size={20} />
                  <span>No issues found for the selected checks.</span>
                </div>
              )}

            {!scanning && scanResult && scanResult.anomalies.length > 0 && (
              <div className="space-y-4">
                <p className="text-sm text-default-500">
                  Found {scanResult.summary.duplicateGroups} title
                  {scanResult.summary.duplicateGroups === 1 ? "" : "s"} with
                  multiple copies ({scanResult.summary.duplicateFiles} files
                  total).
                </p>
                {scanResult.anomalies.map((group) => (
                  <div
                    key={group.key}
                    className="p-4 rounded-xl border border-secondary/30 bg-content1 space-y-3"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <Film className="text-secondary" size={18} />
                      <span className="font-semibold">{group.title}</span>
                      {group.year != null && (
                        <span className="text-default-400">({group.year})</span>
                      )}
                      {group.tmdbId != null && (
                        <Chip size="sm" variant="flat">
                          TMDB {group.tmdbId}
                        </Chip>
                      )}
                      <Chip color="secondary" size="sm" variant="flat">
                        {group.files.length} copies
                      </Chip>
                    </div>
                    <ul className="space-y-2">
                      {group.files.map((file) => (
                        <li
                          key={file.path}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg bg-content2/50 border border-content3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {file.fileName}
                            </p>
                            <p className="text-xs text-default-500 font-mono truncate">
                              {file.path}
                            </p>
                            <p className="text-xs text-default-400 mt-1">
                              {file.sizeFormatted}
                            </p>
                          </div>
                          <Button
                            color="danger"
                            isDisabled={
                              deletingPath !== null && deletingPath !== file.path
                            }
                            isLoading={deletingPath === file.path}
                            onPress={() => setPendingDelete(file)}
                            size="sm"
                            startContent={
                              deletingPath !== file.path && (
                                <Trash2 size={14} />
                              )
                            }
                            variant="flat"
                          >
                            Delete this copy
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {!scanning && scanResult && scanResult.largeFiles.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm text-default-500">
                  Found {scanResult.summary.largeFiles} file
                  {scanResult.summary.largeFiles === 1 ? "" : "s"} over 10 GB.
                </p>
                <ul className="space-y-2">
                  {scanResult.largeFiles.map((file) => (
                    <li
                      key={file.path}
                      className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 p-3 rounded-lg bg-content2/50 border border-secondary/40"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium truncate flex items-center gap-2">
                          <HardDrive
                            className="text-secondary flex-shrink-0"
                            size={16}
                          />
                          {file.fileName}
                        </p>
                        <p className="text-xs text-default-500 font-mono truncate">
                          {file.path}
                        </p>
                        <p className="text-xs font-semibold text-secondary">
                          {file.sizeFormatted}
                          {file.bitrateMbps != null &&
                            ` · ~${file.bitrateMbps.toFixed(1)} Mbps`}
                          {file.durationFormatted &&
                            ` · ${file.durationFormatted}`}
                        </p>
                        <ul className="text-xs text-default-500 space-y-1 list-disc pl-4 mt-2">
                          {file.explanations.map((line, idx) => (
                            <li key={`${file.path}-${idx}`} className="break-words">
                              {line}
                            </li>
                          ))}
                        </ul>
                        {file.probeError && (
                          <p className="text-xs text-default-400 font-mono break-all line-clamp-2">
                            {file.probeError}
                          </p>
                        )}
                      </div>
                      <Button
                        className="sm:mt-1"
                        color="danger"
                        isDisabled={
                          deletingPath !== null && deletingPath !== file.path
                        }
                        isLoading={deletingPath === file.path}
                        onPress={() => setPendingDelete(file)}
                        size="sm"
                        startContent={
                          deletingPath !== file.path && <Trash2 size={14} />
                        }
                        variant="flat"
                      >
                        Delete file
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!scanning && scanResult && scanResult.corruptFiles.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm text-default-500">
                  Found {scanResult.summary.corruptedFiles} file
                  {scanResult.summary.corruptedFiles === 1 ? "" : "s"} that
                  failed ffprobe integrity checks.
                </p>
                <ul className="space-y-2">
                  {scanResult.corruptFiles.map((file) => (
                    <li
                      key={file.path}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg bg-content2/50 border border-danger/30"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate flex items-center gap-2">
                          <AlertTriangle
                            className="text-danger flex-shrink-0"
                            size={16}
                          />
                          {file.fileName}
                        </p>
                        <p className="text-xs text-default-500 font-mono truncate">
                          {file.path}
                        </p>
                        <p className="text-xs text-danger mt-1">
                          {file.reasonLabel}
                        </p>
                        {file.detail && (
                          <p className="text-xs text-default-400 mt-1 font-mono break-all line-clamp-3">
                            {file.detail}
                          </p>
                        )}
                        <p className="text-xs text-default-400 mt-1">
                          {file.sizeFormatted}
                        </p>
                      </div>
                      <Button
                        color="danger"
                        isDisabled={
                          deletingPath !== null && deletingPath !== file.path
                        }
                        isLoading={deletingPath === file.path}
                        onPress={() => setPendingDelete(file)}
                        size="sm"
                        startContent={
                          deletingPath !== file.path && <Trash2 size={14} />
                        }
                        variant="flat"
                      >
                        Delete file
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="pt-2 border-t border-content3 space-y-3">
              {schedulerStatus?.scanInProgress && (
                <div className="flex items-center gap-2 text-sm text-secondary">
                  <YLogoLoader color="secondary" size="sm" />
                  <span>Scheduled scan in progress…</span>
                </div>
              )}
              {anomalyPrefs.anomalyDetectorAutoScanEnabled &&
                schedulerStatus?.isScheduled && (
                  <p className="text-xs text-default-500">
                    Auto-scan every{" "}
                    {anomalyPrefs.anomalyDetectorScanInterval || 1800}s
                    {schedulerStatus.lastRun
                      ? ` · last run ${new Date(schedulerStatus.lastRun).toLocaleString()}`
                      : ""}
                  </p>
                )}
              <ActivityLogPanel
                category="anomaly_detector"
                defaultLimit={25}
                description="Manual and automatic scans — stored permanently like rename history."
                emptyMessage="No scans logged yet. Run Scan library or enable automatic scan."
                refreshToken={activityLogRefresh}
                title="Scan log"
              />
            </div>
          </CardBody>
        )}
      </Card>

      <Modal
        isOpen={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Delete file from disk?</ModalHeader>
              <ModalBody>
                <p className="text-sm text-default-600">
                  This permanently deletes the file from disk. It cannot be
                  undone.
                </p>
                {pendingDelete && (
                  <p className="text-xs font-mono break-all mt-2 text-default-500">
                    {pendingDelete.path}
                  </p>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  Cancel
                </Button>
                <Button
                  color="danger"
                  onPress={() => {
                    void confirmDelete();
                    onClose();
                  }}
                >
                  Delete file
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}