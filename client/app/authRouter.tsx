"use client";

import { useEffect, useState, ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import axios from "axios";
import { useAuth } from "@/context/AuthContext";
import {
  DEFAULT_AUTHENTICATED_ROUTE,
  LOGIN_ROUTE,
  REGISTER_ROUTE,
  requiresAuthentication,
} from "@/lib/authRoutes";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3013";

const AuthRouter = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathName = usePathname();
  const [setupLoading, setSetupLoading] = useState(true);
  const [isFirstRun, setIsFirstRun] = useState(false);

  useEffect(() => {
    if (loading) return;

    if (user) {
      setSetupLoading(false);
      return;
    }

    let cancelled = false;

    const loadSetupStatus = async () => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/Settings/public-registration-status`,
        );
        if (!cancelled) {
          setIsFirstRun(Boolean(response.data?.isFirstRun));
        }
      } catch {
        if (!cancelled) {
          setIsFirstRun(false);
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

    if (isFirstRun && pathName !== REGISTER_ROUTE) {
      router.replace(REGISTER_ROUTE);
      return;
    }

    if (requiresAuthentication(pathName)) {
      router.replace(unauthEntry);
    }
  }, [loading, setupLoading, user, isFirstRun, pathName, router]);

  const awaitingFirstRunSetup =
    !user &&
    !loading &&
    !setupLoading &&
    isFirstRun &&
    pathName !== REGISTER_ROUTE;

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