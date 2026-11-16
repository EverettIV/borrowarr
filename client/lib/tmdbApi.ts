import axios, { type AxiosRequestConfig } from "axios";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3013";

let interceptorInstalled = false;

export function getTmdbAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("accessToken");
}

export function tmdbAuthHeaders(
  token?: string | null,
): Record<string, string> {
  const accessToken = token ?? getTmdbAccessToken();
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

/** Attach Bearer token to all /api/TMDB axios requests (client-side). */
export function installTmdbAuthInterceptor(): void {
  if (interceptorInstalled || typeof window === "undefined") return;
  interceptorInstalled = true;

  axios.interceptors.request.use((config) => {
    const url = config.url || "";
    const isBorrowarrTmdb =
      url.includes("/api/TMDB") ||
      (url.startsWith(API_BASE_URL) && url.includes("/api/TMDB"));
    if (!isBorrowarrTmdb) return config;

    const token = getTmdbAccessToken();
    if (!token) return config;

    config.headers = config.headers ?? {};
    const headers = config.headers as Record<string, string>;
    if (!headers.Authorization) {
      headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });
}

export function tmdbRequestConfig(
  token?: string | null,
  config?: AxiosRequestConfig,
): AxiosRequestConfig {
  return {
    ...config,
    headers: {
      ...tmdbAuthHeaders(token),
      ...config?.headers,
    },
  };
}