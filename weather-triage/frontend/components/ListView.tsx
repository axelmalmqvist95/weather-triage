"use client";

import { useMemo, useState } from "react";
import { Search, History } from "lucide-react";
import { Job, RiskLevel } from "@/lib/types";
import { RescheduleControl } from "./RescheduleControl";

interface Props {
  jobs: Job[];
  onReschedule: (jobId: string, newDate: string) => void;
  onOpenHistory: (jobId: string) => void;
}

type RiskFilter = "all" | RiskLevel;

const RISK_ORDER: Record<RiskLevel, number> = { red: 0, amber: 1, green: 2 };

const FILTER_TABS: { id: RiskFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "red", label: "Reschedule" },
  { id: "amber", label: "Review" },
  { id: "green", label: "Clear" },
];

function formatDayHeading(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function ListView({ jobs, onReschedule, onOpenHistory }: Props) {
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [jobTypeFilter, setJobTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const jobTypes = useMemo(
    () => Array.from(new Set(jobs.map((j) => j.job_type))).sort(),
    [jobs]
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return jobs.filter((job) => {
      if (riskFilter !== "all" && job.risk_level !== riskFilter) return false;
      if (jobTypeFilter !== "all" && job.job_type !== jobTypeFilter) return false;
      if (query && !job.address.toLowerCase().includes(query) && !job.job_id.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [jobs, riskFilter, jobTypeFilter, search]);

  const groupedByDay = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const job of filtered) {
      const list = map.get(job.date) ?? [];
      list.push(job);
      map.set(job.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => RISK_ORDER[a.risk_level] - RISK_ORDER[b.risk_level] || a.time.localeCompare(b.time));
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex flex-col gap-3 rounded-lg border border-app-border bg-app-surface p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1" role="group" aria-label="Filter by status">
          {FILTER_TABS.map((tab) => {
            const count =
              tab.id === "all" ? jobs.length : jobs.filter((j) => j.risk_level === tab.id).length;
            return (
              <button
                key={tab.id}
                onClick={() => setRiskFilter(tab.id)}
                aria-pressed={riskFilter === tab.id}
                className={[
                  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  riskFilter === tab.id
                    ? "bg-brand text-white"
                    : "text-app-text-muted hover:bg-app-bg",
                ].join(" ")}
              >
                {tab.label} <span className="opacity-70">({count})</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={jobTypeFilter}
            onChange={(e) => setJobTypeFilter(e.target.value)}
            aria-label="Filter by job type"
            className="rounded-md border border-app-border bg-app-surface px-2 py-1.5 text-xs text-app-text"
          >
            <option value="all">All job types</option>
            {jobTypes.map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </select>

          <div className="relative">
            <Search
              size={13}
              aria-hidden="true"
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-app-text-muted"
            />
            <input
              type="text"
              placeholder="Search address or job ID"
              aria-label="Search by address or job ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-app-border bg-app-surface py-1.5 pl-7 pr-2 text-xs text-app-text placeholder:text-app-text-muted sm:w-56"
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-app-border p-8 text-center text-sm text-app-text-muted">
          No jobs match the current filters.
        </div>
      )}

      {groupedByDay.map(([day, dayJobs]) => (
        <div key={day}>
          <div className="mb-2 flex items-baseline gap-2 px-1">
            <h3 className="text-sm font-semibold text-app-text">{formatDayHeading(day)}</h3>
            <span className="text-xs text-app-text-muted">{dayJobs.length} jobs</span>
          </div>
          <div className="flex flex-col gap-2">
            {dayJobs.map((job) => (
              <div
                key={job.job_id}
                className="rounded-md border border-app-border bg-app-surface p-3 text-sm shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono font-medium text-app-text">{job.job_id}</div>
                      <div className="truncate text-app-text-muted">{job.address}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onOpenHistory(job.job_id)}
                        aria-label={`View history for ${job.job_id}`}
                        className="rounded p-1 text-app-text-muted hover:bg-app-bg hover:text-app-text"
                      >
                        <History size={14} />
                      </button>
                      <RescheduleControl
                        level={job.risk_level}
                        currentDate={job.date}
                        suggestedDate={job.suggested_reschedule_date}
                        onReschedule={(newDate) => onReschedule(job.job_id, newDate)}
                      />
                    </div>
                  </div>
                <div className="mt-1.5 flex items-center justify-between text-app-text-muted">
                  <span className="capitalize">{job.job_type.replace("_", " ")}</span>
                  <span className="font-mono">{job.time}</span>
                </div>
                {job.reasons.length > 0 && (
                  <div className="mt-1.5 border-t border-app-border pt-1.5 text-xs text-app-text-muted">
                    {job.reasons.join("; ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
