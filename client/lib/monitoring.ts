import { getApiBaseUrl } from "@/lib/apiBaseUrl";
import axios from "axios";


export type MonitorMoviePayload = {
  userId: string;
  tmdbId: number;
  title: string;
  posterUrl?: string | null;
  releaseDate?: string | null;
  overview?: string | null;
  qualityProfile?: string;
  minAvailability?: string;
  monitor?: string;
  status?: string;
  /** Default true — server searches indexers using global quality prefs (Radarr-style). */
  searchOnAdd?: boolean;
  /** Force grab even when auto-download is off */
  grabOnAdd?: boolean;
};

export type MonitorSeriesPayload = {
  userId: string;
  tmdbId: number;
  title: string;
  posterUrl?: string | null;
  firstAirDate?: string | null;
  overview?: string | null;
  qualityProfile?: string;
  minAvailability?: string;
  monitor?: string;
  selectedSeasons?: number[] | string;
  selectedEpisodes?: string[] | { seasonNumber: number; episodeNumber: number }[];
  status?: string;
  searchOnAdd?: boolean;
  grabOnAdd?: boolean;
};

export type MonitorAddResult = {
  success: boolean;
  action?: string;
  message?: string;
  isUpdate?: boolean;
  autoDownload?: boolean;
  movie?: unknown;
  series?: unknown;
  probe?: unknown;
};

export function monitorAddNotificationTitle(result: MonitorAddResult): string {
  if (result.isUpdate) {
    if (result.action === "grabbed") return "Already monitored";
    if (result.action === "on_disk") return "Already on disk";
    return "Already monitored";
  }
  if (result.action === "grabbed") return "Release Queued";
  return "Added";
}

export async function addMovieToMonitor(
  payload: MonitorMoviePayload,
  token?: string | null,
): Promise<MonitorAddResult> {
  const response = await axios.post(
    `${getApiBaseUrl()}/api/MonitoredMovies`,
  {
    searchOnAdd: true,
    ...payload,
  },
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  );
  return response.data;
}

export async function addSeriesToMonitor(
  payload: MonitorSeriesPayload,
  token?: string | null,
): Promise<MonitorAddResult> {
  const response = await axios.post(
    `${getApiBaseUrl()}/api/MonitoredSeries`,
  {
    searchOnAdd: true,
    ...payload,
  },
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  );
  return response.data;
}

export async function grabMonitoredMovie(movieId: number, token?: string | null) {
  const response = await axios.post(
    `${getApiBaseUrl()}/api/MonitoredMovies/${movieId}/grab`,
    {},
    { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
  );
  return response.data;
}

export async function grabMonitoredSeries(seriesId: number, token?: string | null) {
  const response = await axios.post(
    `${getApiBaseUrl()}/api/MonitoredSeries/${seriesId}/grab`,
    {},
    { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
  );
  return response.data;
}

export async function runMonitoringCycle(userId: string, token?: string | null) {
  const response = await axios.post(
    `${getApiBaseUrl()}/api/MonitoredMovies/check-all?userId=${encodeURIComponent(userId)}`,
    {},
    { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
  );
  return response.data;
}