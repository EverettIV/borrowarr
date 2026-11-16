const DEFAULT_API_PORT = "3013";

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

/**
 * Base URL for the BorrowArr API (browser → server).
 * When NEXT_PUBLIC_API_URL is unset, uses same hostname as the UI on port 3013
 * (Docker Hub / Unraid images without a baked-in LAN URL).
 */
export function getApiBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (fromEnv) {
    return trimTrailingSlash(fromEnv);
  }

  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:${DEFAULT_API_PORT}`;
  }

  return `http://localhost:${DEFAULT_API_PORT}`;
}