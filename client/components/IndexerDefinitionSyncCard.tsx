"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import { Button, Card, CardBody, CardHeader, Chip, Input, Switch } from "@heroui/react";
import { ChevronDown, ChevronRight, RefreshCw, Search } from "lucide-react";
import { SectionInfoCallout } from "./SectionInfoCallout";
import { ActivityLogPanel } from "./ActivityLogPanel";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3013";

type DefinitionSyncState = {
  enabled: boolean;
  intervalHours: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  definitionCount: number;
  failedCount: number;
  sourceRepo: string;
  sourceRef: string;
  sourceVersion: string | null;
  sourceCommit: string | null;
};

type CatalogRow = {
  id: string;
  name: string;
  language: string;
  privacy: string;
  credentialKind: "none" | "apikey" | "cookie" | "login";
  credentialFields: string[];
  needsCredentials: boolean;
  testStatus: "passed" | "failed" | "needs-credentials" | "untested";
  testError: string | null;
  testCount: number | null;
  testedAt: string | null;
};

type CatalogFilter = "all" | "passed" | "failed" | "needs-credentials" | "untested";

const CREDENTIAL_LABEL: Record<CatalogRow["credentialKind"], string> = {
  none: "No token",
  apikey: "Needs API token",
  cookie: "Needs cookie",
  login: "Needs login",
};

const STATUS_LABEL: Record<CatalogRow["testStatus"], string> = {
  passed: "Passed",
  failed: "Failed",
  "needs-credentials": "Skipped",
  untested: "Not tested",
};

function formatWhen(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

export function IndexerDefinitionSyncCard({
  expanded,
  isAdmin,
  onToggle,
}: {
  expanded: boolean;
  isAdmin: boolean;
  onToggle: () => void;
}) {
  const [state, setState] = useState<DefinitionSyncState | null>(null);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [testedAt, setTestedAt] = useState<string | null>(null);
  const [intervalHours, setIntervalHours] = useState("24");
  const [running, setRunning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingIds, setTestingIds] = useState<string[]>([]);
  const [logRefresh, setLogRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    const response = await axios.get(`${API_BASE_URL}/api/Indexers/definitions/sync`);
    setState(response.data);
    setIntervalHours(String(response.data.intervalHours || 24));
  };

  const loadCatalog = async () => {
    const response = await axios.get(`${API_BASE_URL}/api/Indexers/definitions`);
    setRows(response.data.definitions || []);
    setTestedAt(response.data.testedAt || null);
  };

  useEffect(() => {
    load().catch(() => setError("Could not load indexer definition settings"));
    loadCatalog().catch(() => setError("Could not load indexer definitions"));
  }, []);

  const runTests = async () => {
    setTesting(true);
    setError("");
    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/Indexers/definitions/test`,
        {},
        { timeout: 180000 },
      );
      setRows(response.data.definitions || []);
      setTestedAt(response.data.testedAt || null);
      setLogRefresh((value) => value + 1);
    } catch (err: any) {
      setError(err.response?.data?.error || "Definition test failed");
    } finally {
      setTesting(false);
    }
  };

  const counts = rows.reduce(
    (acc, row) => {
      acc[row.testStatus] += 1;
      return acc;
    },
    { passed: 0, failed: 0, "needs-credentials": 0, untested: 0 } as Record<CatalogRow["testStatus"], number>,
  );

  const visible = rows.filter((row) => {
    if (filter !== "all" && row.testStatus !== filter) return false;
    const needle = catalogQuery.trim().toLowerCase();
    if (!needle) return true;
    return (
      row.name.toLowerCase().includes(needle) ||
      row.id.toLowerCase().includes(needle) ||
      row.privacy.toLowerCase().includes(needle) ||
      row.language.toLowerCase().includes(needle) ||
      row.credentialFields.some((field) => field.toLowerCase().includes(needle)) ||
      (row.testError || "").toLowerCase().includes(needle)
    );
  });

  const testOne = async (id: string) => {
    setTestingIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setError("");
    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/Indexers/definitions/test/${encodeURIComponent(id)}`,
        {},
        { timeout: 60000 },
      );
      const updated = response.data.definition as CatalogRow | null;
      if (updated) {
        setRows((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      }
      setLogRefresh((value) => value + 1);
    } catch (err: any) {
      setError(err.response?.data?.error || "Indexer test failed");
    } finally {
      setTestingIds((ids) => ids.filter((item) => item !== id));
    }
  };

  const save = async (patch: { enabled?: boolean; intervalHours?: number }) => {
    setSaving(true);
    setError("");
    try {
      const response = await axios.put(`${API_BASE_URL}/api/Indexers/definitions/sync`, patch);
      setState(response.data);
      setIntervalHours(String(response.data.intervalHours || 24));
    } catch (err: any) {
      setError(err.response?.data?.error || "Could not save indexer definition settings");
    } finally {
      setSaving(false);
    }
  };

  const updateNow = async () => {
    setRunning(true);
    setError("");
    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/Indexers/definitions/sync/run`,
        {},
        { timeout: 180000 },
      );
      setState(response.data);
    } catch (err: any) {
      setError(err.response?.data?.error || "Definition update failed");
      if (err.response?.data?.definitionCount !== undefined) {
        setState(err.response.data);
      }
    } finally {
      setRunning(false);
    }
  };

  const commit = state?.sourceCommit ? state.sourceCommit.slice(0, 7) : null;

  return (
    <Card className="border border-content2">
      <CardHeader
        className="cursor-pointer hover:bg-content2/50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <RefreshCw className="text-secondary" size={24} />
            <div>
              <h2 className="text-lg font-semibold">Indexer definitions</h2>
              <p className="text-sm text-default-500">
                {state
                  ? `${state.definitionCount || 0} definitions from Prowlarr`
                  : "Cardigann YAML files from Prowlarr"}
              </p>
            </div>
          </div>
          {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </div>
      </CardHeader>
      {expanded && (
        <CardBody className="pt-0 space-y-4">
          <SectionInfoCallout>
            BorrowArr loads indexer support from the Cardigann YAML files Prowlarr
            publishes. Automatic updates replace the local copies on the schedule
            below. Saved indexers stay as they are; only the definition files change.
          </SectionInfoCallout>

          <div className="flex flex-wrap items-center gap-2">
            <Chip size="sm" variant="flat">
              {state?.sourceVersion || "not synced yet"}
            </Chip>
            {commit && (
              <Chip size="sm" variant="bordered">
                {commit}
              </Chip>
            )}
            <Chip color={state?.lastError ? "danger" : "success"} size="sm" variant="flat">
              Last update {formatWhen(state?.lastSuccessAt || null)}
            </Chip>
            {state?.failedCount ? (
              <Chip color="warning" size="sm" variant="flat">
                {state.failedCount} could not be loaded
              </Chip>
            ) : null}
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            <Switch
              color="secondary"
              isDisabled={!isAdmin || saving || running}
              isSelected={Boolean(state?.enabled)}
              onValueChange={(enabled) => save({ enabled, intervalHours: Number(intervalHours) || 24 })}
            >
              Update automatically
            </Switch>
            <Input
              className="max-w-[180px]"
              description="Hours between updates"
              isDisabled={!isAdmin || saving || running}
              label="Every"
              min={1}
              type="number"
              value={intervalHours}
              onValueChange={setIntervalHours}
              onBlur={() => {
                const hours = Number(intervalHours);
                if (!state || hours === state.intervalHours) return;
                save({ enabled: state.enabled, intervalHours: hours });
              }}
            />
            <Button
              color="secondary"
              isDisabled={!isAdmin}
              isLoading={running}
              onPress={updateNow}
              startContent={!running && <RefreshCw size={16} />}
              variant="flat"
            >
              Update now
            </Button>
          </div>

          {!isAdmin && (
            <p className="text-sm text-default-500">
              An admin sets the update schedule and can replace the definitions.
            </p>
          )}
          {(error || state?.lastError) && (
            <p className="text-sm text-danger">{error || state?.lastError}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Search indexers"
              className="min-w-[240px] flex-1"
              placeholder="Search indexers by name, id, token, or error"
              startContent={<Search className="text-default-400" size={16} />}
              value={catalogQuery}
              onValueChange={setCatalogQuery}
              isClearable
              onClear={() => setCatalogQuery("")}
            />
            <Button
              color="secondary"
              isDisabled={!isAdmin}
              isLoading={testing}
              onPress={runTests}
              variant="flat"
            >
              Test definitions
            </Button>
          </div>
          {catalogQuery.trim() && (
            <p className="text-xs text-default-500">
              {visible.length} of {rows.length} indexers
            </p>
          )}
          <p className="text-xs text-default-500">
            {testedAt
              ? `Last test ${formatWhen(testedAt)}. Public sites were searched for “ubuntu”.`
              : "Public sites are searched for “ubuntu”. Accounts are not contacted."}
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", `All ${rows.length}`],
                ["passed", `Passed ${counts.passed}`],
                ["failed", `Failed ${counts.failed}`],
                ["needs-credentials", `Needs account ${counts["needs-credentials"]}`],
                ["untested", `Not tested ${counts.untested}`],
              ] as [CatalogFilter, string][]
            ).map(([key, label]) => (
              <Chip
                key={key}
                className="cursor-pointer"
                color={filter === key ? "secondary" : "default"}
                variant={filter === key ? "solid" : "flat"}
                onClick={() => setFilter(key)}
              >
                {label}
              </Chip>
            ))}
          </div>

          <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-content3">
            {visible.length === 0 ? (
              <p className="px-3 py-6 text-sm text-default-500">No definitions match.</p>
            ) : (
              visible.map((row) => {
                const detail = row.testStatus === "failed"
                  ? row.testError
                  : row.credentialFields.length
                    ? row.credentialFields.join(", ")
                    : row.testStatus === "passed"
                      ? `${row.testCount} releases`
                      : null;
                return (
                  <div
                    key={row.id}
                    className="flex items-start justify-between gap-3 border-b border-content3 px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{row.name}</div>
                      <div className="truncate text-xs text-default-500">{row.id}</div>
                      {detail && (
                        <p className="mt-1 text-xs text-default-500">{detail}</p>
                      )}
                    </div>
                    <div className="flex max-w-[20rem] flex-wrap items-center justify-end gap-1">
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="flat"
                          isDisabled={testing}
                          isLoading={testingIds.includes(row.id)}
                          onPress={() => testOne(row.id)}
                        >
                          Test
                        </Button>
                      )}
                      <Chip size="sm" variant="bordered">{row.privacy}</Chip>
                      <Chip
                        color={row.credentialKind === "none" ? "success" : "warning"}
                        size="sm"
                        variant="flat"
                      >
                        {CREDENTIAL_LABEL[row.credentialKind]}
                      </Chip>
                      <Chip
                        color={
                          row.testStatus === "passed"
                            ? "success"
                            : row.testStatus === "failed"
                              ? "danger"
                              : "default"
                        }
                        size="sm"
                        variant="flat"
                      >
                        {STATUS_LABEL[row.testStatus]}
                      </Chip>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <ActivityLogPanel
            category="indexer_definitions"
            description="Each Test click and each full run is logged here. Open an entry for the result. Definitions that need an account are counted in a full run, not listed."
            emptyMessage="No indexer tests yet. Test definitions to record passes and failures."
            refreshToken={logRefresh}
            title="Test log"
          />
        </CardBody>
      )}
    </Card>
  );
}
