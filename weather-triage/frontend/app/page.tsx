"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { LayoutGrid, Map as MapIcon, List, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { Crew, Job, NewJobInput } from "@/lib/types";
import { TopBar } from "@/components/TopBar";
import { KpiCards } from "@/components/KpiCards";
import { DispatchGrid } from "@/components/DispatchGrid";
import { ListView } from "@/components/ListView";
import { AddJobModal } from "@/components/AddJobModal";
import { JobHistoryPanel } from "@/components/JobHistoryPanel";

// Leaflet touches `window` on import, so it can only run client-side.
const RiskMap = dynamic(() => import("@/components/RiskMap").then((m) => m.RiskMap), {
  ssr: false,
});

type View = "grid" | "map" | "list";

function nextNDays(n: number): string[] {
  const today = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

export default function Page() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [view, setView] = useState<View>("grid");
  const [isNarrow, setIsNarrow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddJob, setShowAddJob] = useState(false);
  const [historyJobId, setHistoryJobId] = useState<string | null>(null);

  const days = useMemo(() => nextNDays(7), []);
  const jobTypes = useMemo(() => Array.from(new Set(jobs.map((j) => j.job_type))).sort(), [jobs]);

  // The crew × day grid needs real horizontal space to be usable — it isn't
  // a layout that degrades gracefully to a phone screen, unlike the list
  // view. Rather than ship a grid that's technically "responsive" but
  // practically unusable, default to the list view below the sm breakpoint
  // and hide the grid tab entirely there.
  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const apply = () => {
      setIsNarrow(query.matches);
      setView((current) => (query.matches && current === "grid" ? "list" : current));
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    Promise.all([api.getJobs(), api.getCrews()])
      .then(([jobsData, crewsData]) => {
        setJobs(jobsData);
        setCrews(crewsData);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  async function handleReschedule(jobId: string, newDate: string) {
    // Optimistic update so the drag feels immediate, then reconcile with
    // the server's actual risk assessment for the new date.
    const previous = jobs;
    setJobs((cur) => cur.map((j) => (j.job_id === jobId ? { ...j, date: newDate } : j)));
    try {
      const updated = await api.rescheduleJob(jobId, newDate);
      setJobs((cur) => cur.map((j) => (j.job_id === jobId ? updated : j)));
    } catch {
      setJobs(previous);
    }
  }

  async function handleCreateJob(input: NewJobInput) {
    const created = await api.createJob(input);
    setJobs((cur) => [...cur, created]);
    setShowAddJob(false);
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-app-text-muted">
        Loading schedule&hellip;
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 text-app-text-muted">
        <p>Could not reach the API.</p>
        <p className="font-mono text-xs">{error}</p>
        <p className="text-xs">
          Is the backend running at{" "}
          <code className="font-mono">{process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}</code>?
        </p>
      </div>
    );
  }

  const viewTabs: { id: View; label: string; Icon: typeof LayoutGrid; hideOnNarrow?: boolean }[] = [
    { id: "grid", label: "Dispatch grid", Icon: LayoutGrid, hideOnNarrow: true },
    { id: "map", label: "Map", Icon: MapIcon },
    { id: "list", label: "List", Icon: List },
  ];

  return (
    <div className="min-h-screen bg-app-bg">
      <TopBar jobCount={jobs.length} generatedAt={new Date().toLocaleDateString("en-US")} />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <KpiCards jobs={jobs} />

        <div className="mt-6 flex items-center justify-between gap-2 border-b border-app-border">
          <div className="flex gap-1 overflow-x-auto" role="tablist">
            {viewTabs
              .filter((tab) => !(tab.hideOnNarrow && isNarrow))
              .map(({ id, label, Icon }) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={view === id}
                  onClick={() => setView(id)}
                  className={[
                    "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                    view === id
                      ? "border-brand text-brand"
                      : "border-transparent text-app-text-muted hover:text-app-text",
                  ].join(" ")}
                >
                  <Icon size={15} aria-hidden="true" />
                  {label}
                </button>
              ))}
          </div>

          <button
            onClick={() => setShowAddJob(true)}
            className="mb-2 flex shrink-0 items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
          >
            <Plus size={14} />
            Add job
          </button>
        </div>

        {isNarrow && view === "grid" && (
          <p className="mt-3 text-xs text-app-text-muted">
            The dispatch grid needs a wider screen. Showing the list view instead.
          </p>
        )}

        <div className="mt-4">
          {view === "grid" && !isNarrow && (
            <DispatchGrid jobs={jobs} crews={crews} days={days} onReschedule={handleReschedule} />
          )}
          {view === "map" && <RiskMap jobs={jobs} />}
          {view === "list" && (
            <ListView jobs={jobs} onReschedule={handleReschedule} onOpenHistory={setHistoryJobId} />
          )}
        </div>
      </main>

      {showAddJob && (
        <AddJobModal
          crews={crews}
          jobTypes={jobTypes}
          onClose={() => setShowAddJob(false)}
          onSubmit={handleCreateJob}
        />
      )}

      {historyJobId && (
        <JobHistoryPanel jobId={historyJobId} onClose={() => setHistoryJobId(null)} />
      )}
    </div>
  );
}
