"use client";

import { useEffect, useState, ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  DEFAULT_AUTHENTICATED_ROUTE,
  LOGIN_ROUTE,
  REGISTER_ROUTE,
  requiresAuthentication,
} from "@/lib/authRoutes";
import { fetchSetupStatus } from "@/lib/setupStatus";

const AuthRouter = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathName = usePathname();
  const [setupLoading, setSetupLoading] = useState(true);
  const [isFirstRun, setIsFirstRun] = useState(false);
  const [setupError, setSetupError] = useState(false);

  useEffect(() => {
    if (loading) return;

    if (user) {
      setSetupLoading(false);
      setSetupError(false);
      return;
    }

    let cancelled = false;

    const loadSetupStatus = async () => {
      setSetupError(false);
      setSetupLoading(true);
      try {
        const status = await fetchSetupStatus();
        if (!cancelled) {
          setIsFirstRun(status.isFirstRun);
        }
      } catch {
        if (!cancelled) {
          setSetupError(true);
        }
      } finally {
        if (!cancelled) {
          setSetupLoading(false);
        }
      }
    };

    void loadSetupStatus();

    return () => {
      cancelled = true;
    };
  }, [loading, user]);

  useEffect(() => {
    if (loading || setupLoading) return;

    const unauthEntry = isFirstRun ? REGISTER_ROUTE : LOGIN_ROUTE;

    if (user) {
      if (pathName === LOGIN_ROUTE || pathName === REGISTER_ROUTE) {
        router.replace(DEFAULT_AUTHENTICATED_ROUTE);
      }
      return;
    }

    if (isFirstRun) {
      if (pathName === LOGIN_ROUTE) {
        router.replace(REGISTER_ROUTE);
        return;
      }
      if (pathName !== REGISTER_ROUTE) {
        router.replace(REGISTER_ROUTE);
        return;
      }
      return;
    }

    if (setupError) {
      return;
    }

    if (requiresAuthentication(pathName)) {
      router.replace(unauthEntry);
    }
  }, [loading, setupLoading, setupError, user, isFirstRun, pathName, router]);

  const awaitingFirstRunSetup =
    !user &&
    !loading &&
    !setupLoading &&
    isFirstRun &&
    pathName !== REGISTER_ROUTE;

  const reloadSetupStatus = () => {
    setSetupLoading(true);
    setSetupError(false);
    void fetchSetupStatus()
      .then((status) => {
        setIsFirstRun(status.isFirstRun);
      })
      .catch(() => {
        setSetupError(true);
      })
      .finally(() => {
        setSetupLoading(false);
      });
  };

  if (setupError && !user && !loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <p className="text-foreground/80">
            Could not reach the BorrowArr server. Make sure the API is running
            and try again.
          </p>
          <button
            className="px-4 py-2 rounded-lg bg-secondary text-secondary-foreground font-medium"
            onClick={reloadSetupStatus}
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (loading || setupLoading || awaitingFirstRunSetup) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-3 border-content3 border-t-secondary rounded-full animate-spin" />
          <p className="text-foreground opacity-70">Loading...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AuthRouter;