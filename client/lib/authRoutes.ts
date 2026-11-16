export const LOGIN_ROUTE = "/pages/login";
export const REGISTER_ROUTE = "/pages/register";
export const DEFAULT_AUTHENTICATED_ROUTE = "/pages/discover";

/** Routes reachable without logging in */
export const PUBLIC_APP_ROUTES = [LOGIN_ROUTE, REGISTER_ROUTE] as const;

export function isPublicAppRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return (PUBLIC_APP_ROUTES as readonly string[]).includes(pathname);
}

export function requiresAuthentication(pathname: string | null): boolean {
  if (!pathname) return true;
  if (pathname === "/") return true;
  if (!pathname.startsWith("/pages/")) return false;
  return !isPublicAppRoute(pathname);
}