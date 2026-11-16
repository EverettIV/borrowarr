"use client";

import React, { useState, useEffect } from "react";
import axios from "axios";
import { Button } from "@heroui/react";
import { YLogoLoader } from "@/components/YLogoLoader";
import { Input } from "@heroui/react";
import { Card, CardBody, CardHeader } from "@heroui/react";
import { Switch } from "@heroui/react";
import { Select, SelectItem } from "@heroui/react";
import {
  ChevronDown,
  ChevronRight,
  Settings as SettingsIcon,
  Monitor,
  Zap,
  Check,
  X,
  Clock,
} from "lucide-react";
import { PageContent, PageHeader } from "@/components/page-header";
import { SectionInfoCallout } from "../../../components/SectionInfoCallout";
import { ActivityLogPanel } from "../../../components/ActivityLogPanel";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3013";

const CHECK_INTERVAL_DEFAULT_SEC = 300; // 5 minutes
const CHECK_INTERVAL_MIN_SEC = 60;

const QUALITY_OPTIONS = [
  { key: "480p", label: "480p" },
  { key: "720p", label: "720p" },
  { key: "1080p", label: "1080p" },
  { key: "2160p", label: "2160p (4K)" },
] as const;

const QUALITY_RANK: Record<string, number> = {
  "480p": 1,
  "720p": 2,
  "1080p": 3,
  "2160p": 4,
};

function clampQualitySettings(minQuality: string, maxQuality: string) {
  const rank = (q: string) => QUALITY_RANK[q] ?? 2;
  const label = (r: number) =>
    QUALITY_OPTIONS.find((o) => QUALITY_RANK[o.key] === r)?.key ?? "720p";

  let minR = rank(minQuality);
  let maxR = rank(maxQuality);
  if (minR > maxR) maxR = minR;

  return {
    minQuality: label(minR),
    maxQuality: label(maxR),
  };
}

interface Settings {
  id?: number;
  minQuality: string;
  maxQuality: string;
  preferSeedersInQualityRange?: boolean;
  autoDownload: boolean;
  checkInterval: number;
}

const System = () => {
  const [settings, setSettings] = useState<Settings>({
    minQuality: "720p",
    maxQuality: "1080p",
    preferSeedersInQualityRange: true,
    autoDownload: true,
    checkInterval: CHECK_INTERVAL_DEFAULT_SEC,
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["quality", "automation"]),
  );

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const token = localStorage.getItem("accessToken");
      const response = await axios.get(`${API_BASE_URL}/api/Settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = response.data as Settings;
      const clamped = clampQualitySettings(
        data.minQuality || "720p",
        data.maxQuality || "1080p",
      );
      setSettings({
        ...data,
        ...clamped,
        preferSeedersInQualityRange: data.preferSeedersInQualityRange ?? true,
      });
      setLoading(false);
    } catch (error) {
      console.error("Error fetching settings:", error);
      setMessage({ type: "error", text: "Failed to load settings" });
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const token = localStorage.getItem("accessToken");
      const qualities = clampQualitySettings(
        settings.minQuality,
        settings.maxQuality,
      );
      const updateData = {
        ...qualities,
        preferSeedersInQualityRange: settings.preferSeedersInQualityRange ?? true,
        autoDownload: settings.autoDownload,
        checkInterval: Math.max(
          CHECK_INTERVAL_MIN_SEC,
          settings.checkInterval || CHECK_INTERVAL_DEFAULT_SEC,
        ),
      };

      const response = await axios.put(
        `${API_BASE_URL}/api/Settings`,
        updateData,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      setSettings(response.data);
      setMessage({ type: "success", text: "Settings saved successfully!" });
      setTimeout(() => setMessage(null), 3000);
    } catch (error: unknown) {
      console.error("Error saving settings:", error);
      const err = error as {
        response?: { data?: { error?: string; message?: string } };
      };
      const errorMsg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        "Failed to save settings";
      setMessage({ type: "error", text: errorMsg });
    } finally {
      setSaving(false);
    }
  };

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

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader
          description="Configure quality limits and automation behaviour."
          icon={<SettingsIcon className="h-6 w-6" />}
          title="Monitor Settings"
          tone="secondary"
        />

        <PageContent>
          <div className="flex flex-col items-center justify-center py-16 rounded-xl border border-secondary/20 bg-content1">
            <YLogoLoader color="secondary" size="lg" />
            <p className="mt-4 text-foreground/60">
              Loading monitor settings...
            </p>
          </div>
        </PageContent>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        description="Configure quality limits and automation behaviour."
        icon={<SettingsIcon className="h-6 w-6" />}
        title="Monitor Settings"
        tone="secondary"
      />

      <PageContent>
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
          {/* Quality Settings */}
          <Card className="border border-content2">
            <CardHeader
              className="cursor-pointer hover:bg-content2/50 transition-colors"
              onClick={() => toggleSection("quality")}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  <Monitor className="text-secondary" size={24} />
                  <div>
                    <h2 className="text-lg font-semibold">Quality Settings</h2>
                    <p className="text-sm text-default-500">
                      Minimum and maximum quality for downloads
                    </p>
                  </div>
                </div>
                {expandedSections.has("quality") ? (
                  <ChevronDown size={20} />
                ) : (
                  <ChevronRight size={20} />
                )}
              </div>
            </CardHeader>
            {expandedSections.has("quality") && (
              <CardBody className="pt-0 space-y-6">
                <SectionInfoCallout>
                  Only releases between your minimum and maximum quality are
                  considered. With <strong className="text-foreground">Prefer seeders</strong>{" "}
                  on (default), the highest seeder count wins in that range—e.g. 4K
                  with 80 seeders beats 1080p with 2. Turn it off to use a balanced
                  score (still min–max only) when swarms are similar.
                </SectionInfoCallout>
                <div className="grid gap-4 md:grid-cols-2">
                  <Select
                    classNames={{
                      trigger:
                        "bg-content2 border border-secondary/20 hover:border-secondary/40",
                    }}
                    label="Minimum quality"
                    selectedKeys={
                      settings.minQuality ? [settings.minQuality] : []
                    }
                    onSelectionChange={(keys) => {
                      const selected = Array.from(keys)[0] as string;
                      if (selected) {
                        setSettings({
                          ...settings,
                          ...clampQualitySettings(selected, settings.maxQuality),
                        });
                      }
                    }}
                  >
                    {QUALITY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.key}>{opt.label}</SelectItem>
                    ))}
                  </Select>
                  <Select
                    classNames={{
                      trigger:
                        "bg-content2 border border-secondary/20 hover:border-secondary/40",
                    }}
                    label="Maximum quality"
                    selectedKeys={
                      settings.maxQuality ? [settings.maxQuality] : []
                    }
                    onSelectionChange={(keys) => {
                      const selected = Array.from(keys)[0] as string;
                      if (selected) {
                        setSettings({
                          ...settings,
                          ...clampQualitySettings(settings.minQuality, selected),
                        });
                      }
                    }}
                  >
                    {QUALITY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.key}>{opt.label}</SelectItem>
                    ))}
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-3 p-4 rounded-lg border border-secondary/30 bg-secondary/5">
                  <div className="min-w-0">
                    <p className="font-medium">Prefer seeders in quality range</p>
                    <p className="text-xs text-default-500">
                      Among releases between min and max, always pick the highest
                      seeder count (indexer priority breaks ties).
                    </p>
                  </div>
                  <Switch
                    color="secondary"
                    isSelected={settings.preferSeedersInQualityRange ?? true}
                    onValueChange={(checked) =>
                      setSettings({
                        ...settings,
                        preferSeedersInQualityRange: checked,
                      })
                    }
                  />
                </div>
              </CardBody>
            )}
          </Card>

          {/* Automation */}
          <Card className="border border-content2">
            <CardHeader
              className="cursor-pointer hover:bg-content2/50 transition-colors"
              onClick={() => toggleSection("automation")}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  <Zap className="text-secondary" size={24} />
                  <div>
                    <h2 className="text-lg font-semibold">Automation</h2>
                    <p className="text-sm text-default-500">
                      Automatic grabs and how often monitored titles are checked
                    </p>
                  </div>
                </div>
                {expandedSections.has("automation") ? (
                  <ChevronDown size={20} />
                ) : (
                  <ChevronRight size={20} />
                )}
              </div>
            </CardHeader>
            {expandedSections.has("automation") && (
              <CardBody className="pt-0 space-y-6">
                <SectionInfoCallout>
                  When Automatic Grab is on, BorrowArr queues matching releases
                  in your download client for monitored titles—no extra approval
                  on the Monitored page. The check interval
                  controls how often the background job scans for new releases
                  and missing episodes (in seconds; default 300s / 5 minutes).
                  Shorter intervals react faster but use more indexer and server
                  time.
                </SectionInfoCallout>
                <div className="flex items-center justify-between gap-3 p-4 rounded-lg border border-secondary/30 bg-secondary/5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-secondary/20 flex-shrink-0">
                      <Zap className="text-secondary" size={18} />
                    </div>
                    <div>
                      <p className="font-medium">Automatic Grab</p>
                      <p className="text-xs text-default-500">
                        Search indexers and queue grabs when a matching release appears
                      </p>
                    </div>
                  </div>
                  <Switch
                    color="secondary"
                    isSelected={settings.autoDownload}
                    onValueChange={(checked) =>
                      setSettings({ ...settings, autoDownload: checked })
                    }
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3 p-4 rounded-lg border border-content3">
                  <Clock className="text-secondary flex-shrink-0" size={18} />
                  <div className="flex-1 min-w-0">
                    <label
                      className="text-sm font-medium"
                      htmlFor="checkInterval"
                    >
                      Check interval
                    </label>
                    <p className="text-xs text-default-500">
                      How often to check for new releases and missing files (min{" "}
                      {CHECK_INTERVAL_MIN_SEC}s — default 5 minutes)
                    </p>
                  </div>
                  <Input
                    className="max-w-32"
                    endContent={
                      <span className="text-xs text-default-400">sec</span>
                    }
                    id="checkInterval"
                    min={CHECK_INTERVAL_MIN_SEC}
                    type="number"
                    value={String(settings.checkInterval)}
                    onValueChange={(value) => {
                      const parsed = parseInt(value, 10);
                      const next = Number.isFinite(parsed)
                        ? Math.max(CHECK_INTERVAL_MIN_SEC, parsed)
                        : CHECK_INTERVAL_DEFAULT_SEC;
                      setSettings({
                        ...settings,
                        checkInterval: next,
                      });
                    }}
                  />
                </div>

                <ActivityLogPanel
                  category="monitoring"
                  defaultLimit={25}
                  description="Monitored adds, queued grabs, and imports into library folders. Admins see all users."
                  emptyMessage="No monitoring activity yet. Add titles to Monitored or enable Automatic Grab."
                  scopeAllForAdmin
                  title="Monitoring activity"
                />
              </CardBody>
            )}
          </Card>

          <div className="flex justify-end">
            <Button
              color="secondary"
              isLoading={saving}
              onPress={handleSave}
              size="lg"
            >
              {saving ? "Saving…" : "Save Settings"}
            </Button>
          </div>
        </div>
      </PageContent>
    </div>
  );
};

export default System;