"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Car,
  Clock,
  ExternalLink,
  GripVertical,
  Home,
  RotateCcw,
  Save,
  Sparkles,
  Target,
  Wand2,
} from "lucide-react";
import { api } from "@/lib/api";
import { Plan, PlanEdit, PlanRoute, PlanStop, PlanUnassigned } from "@/lib/types";
import { StatusPill } from "./StatusPill";

const UNASSIGNED = "unassigned";

const kr = (n: number) => `${Math.round(n).toLocaleString("sv-SE")} kr`;
const km = (n: number) => `${n.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} km`;
const hm = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
};
const label = (s: string) => s.replace(/_/g, " ");

function assignmentsOf(plan: Plan): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of plan.routes) out[r.crew_id] = r.stops.map((s) => s.job_id);
  return out;
}

function pickDefaultDate(dates: string[]): string | null {
  const today = new Date().toISOString().slice(0, 10);
  return dates.find((d) => d >= today) ?? dates[0] ?? null;
}

interface Props {
  /** Called after a plan is saved, so the rest of the app can reload jobs. */
  onSaved: () => void;
}

export function PlanView({ onSaved }: Props) {
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [current, setCurrent] = useState<Plan | null>(null);
  const [keepOrder, setKeepOrder] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => {
    api
      .getPlanDates()
      .then((d) => {
        setDates(d);
        setDate(pickDefaultDate(d));
      })
      .catch((e) => setError(String(e)));
  }, []);

  const loadProposal = useCallback(async (d: string) => {
    setBusy(true);
    setError(null);
    try {
      const [proposal, cur] = await Promise.all([api.getPlanProposal(d), api.getCurrentPlan(d)]);
      setPlan(proposal);
      setCurrent(cur);
      setKeepOrder(new Set());
      setDirty(true); // a fresh proposal differs from what's saved until applied
      setSavedAt(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (date) loadProposal(date);
  }, [date, loadProposal]);

  async function loadCurrent() {
    if (!date) return;
    setBusy(true);
    try {
      const cur = await api.getCurrentPlan(date);
      setPlan(cur);
      setCurrent(cur);
      setKeepOrder(new Set());
      setDirty(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reevaluate(assignments: Record<string, string[]>, keep: Set<string>) {
    if (!date) return;
    const edit: PlanEdit = { date, assignments, keep_order_for: Array.from(keep) };
    setBusy(true);
    setError(null);
    try {
      setPlan(await api.evaluatePlan(edit));
      setKeepOrder(keep);
      setDirty(true);
      setSavedAt(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function moveJob(jobId: string, toCrew: string) {
    if (!plan) return;
    const assignments = assignmentsOf(plan);
    for (const id of Object.keys(assignments)) {
      assignments[id] = assignments[id].filter((j) => j !== jobId);
    }
    if (toCrew !== UNASSIGNED) assignments[toCrew] = [...(assignments[toCrew] ?? []), jobId];
    reevaluate(assignments, keepOrder);
  }

  function reorder(crewId: string, index: number, delta: -1 | 1) {
    if (!plan) return;
    const assignments = assignmentsOf(plan);
    const list = [...assignments[crewId]];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    assignments[crewId] = list;
    reevaluate(assignments, new Set(keepOrder).add(crewId));
  }

  function reoptimize(crewId: string) {
    if (!plan) return;
    const keep = new Set(keepOrder);
    keep.delete(crewId);
    reevaluate(assignmentsOf(plan), keep);
  }

  async function save() {
    if (!plan || !date) return;
    setBusy(true);
    try {
      const edit: PlanEdit = {
        date,
        assignments: assignmentsOf(plan),
        keep_order_for: Array.from(keepOrder),
      };
      const saved = await api.applyPlan(edit);
      setPlan(saved);
      setCurrent(saved);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }));
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const crewNames = useMemo(
    () => Object.fromEntries((plan?.routes ?? []).map((r) => [r.crew_id, r.crew_name])),
    [plan]
  );

  if (error && !plan) {
    return <p className="text-sm text-status-reschedule-fg">Could not load the plan: {error}</p>;
  }
  if (!date) {
    return <p className="text-sm text-app-text-muted">No jobs to plan yet.</p>;
  }

  const sortedRoutes = (plan?.routes ?? []).slice().sort((a, b) => {
    // Working crews first, then by how far they are from target.
    if (!!a.stops.length !== !!b.stops.length) return a.stops.length ? -1 : 1;
    return a.target_pct - b.target_pct;
  });

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs font-medium text-app-text-muted">
          Day
          <select
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 rounded-md border border-app-border bg-app-surface px-2 py-1.5 text-sm text-app-text"
          >
            {dates.map((d) => (
              <option key={d} value={d}>
                {new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => loadProposal(date)}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-xs font-medium text-app-text hover:bg-app-bg disabled:opacity-50"
        >
          <Sparkles size={14} /> New proposal
        </button>
        <button
          onClick={loadCurrent}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-xs font-medium text-app-text hover:bg-app-bg disabled:opacity-50"
        >
          <RotateCcw size={14} /> Show saved
        </button>
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="ml-auto flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover disabled:opacity-50"
        >
          <Save size={14} /> {dirty ? "Save plan" : savedAt ? `Saved ${savedAt}` : "Saved"}
        </button>
      </div>

      <p className="text-xs text-app-text-muted">
        Proposal: most valuable jobs first, each to the skilled crew with the shortest detour — with a
        nudge towards crews still under their daily target. Drag a stop to another crew or use{" "}
        <span className="font-medium">Move to</span>. Distances are estimates (straight line × 1.3);
        open the route in Google Maps for turn-by-turn.
      </p>

      {error && <p className="text-xs text-status-reschedule-fg">{error}</p>}

      {plan && <Summary plan={plan} current={current} />}

      <div className={busy ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"}>
        {plan && plan.unassigned.length > 0 && (
          <UnassignedCard
            jobs={plan.unassigned}
            crews={plan.routes}
            crewNames={crewNames}
            isDragOver={dragOver === UNASSIGNED}
            setDragOver={setDragOver}
            onMove={moveJob}
          />
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {sortedRoutes.map((route) => (
            <RouteCard
              key={route.crew_id}
              route={route}
              crews={plan!.routes}
              crewNames={crewNames}
              manualOrder={keepOrder.has(route.crew_id)}
              isDragOver={dragOver === route.crew_id}
              setDragOver={setDragOver}
              onMove={moveJob}
              onReorder={reorder}
              onReoptimize={reoptimize}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------

function Summary({ plan, current }: { plan: Plan; current: Plan | null }) {
  const pct = plan.total_target_sek ? (100 * plan.total_revenue_sek) / plan.total_target_sek : 0;
  const kmDelta = current ? plan.total_km - current.total_km : 0;
  const revDelta = current ? plan.total_revenue_sek - current.total_revenue_sek : 0;
  const tiles = [
    {
      label: "Planned revenue",
      value: kr(plan.total_revenue_sek),
      sub: `${Math.round(pct)} % of ${kr(plan.total_target_sek)} target`,
      delta: current && revDelta !== 0 ? `${revDelta > 0 ? "+" : ""}${kr(revDelta)} vs saved` : null,
      good: revDelta >= 0,
    },
    {
      label: "Crews on target",
      value: `${plan.crews_on_target} / ${plan.routes.length}`,
      sub: `${plan.crews_working} crews out driving`,
      delta: null,
      good: true,
    },
    {
      label: "Total driving",
      value: km(plan.total_km),
      sub: "incl. return to base",
      delta:
        current && Math.abs(kmDelta) >= 0.5
          ? `${kmDelta > 0 ? "+" : "−"}${km(Math.abs(kmDelta))} vs saved`
          : null,
      good: kmDelta <= 0,
    },
    {
      label: "Not assigned",
      value: String(plan.unassigned.length),
      sub: kr(plan.unassigned.reduce((s, u) => s + u.price_sek, 0)) + " left on the table",
      delta: null,
      good: plan.unassigned.length === 0,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="status" aria-live="polite">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border border-app-border bg-app-surface p-3 shadow-sm">
          <div className="text-[11px] font-medium uppercase tracking-wide text-app-text-muted">{t.label}</div>
          <div className="mt-1 font-mono text-xl font-semibold text-app-text">{t.value}</div>
          <div className="text-xs text-app-text-muted">{t.sub}</div>
          {t.delta && (
            <div className={`mt-0.5 text-xs font-medium ${t.good ? "text-status-clear-fg" : "text-status-reschedule-fg"}`}>
              {t.delta}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function MoveSelect({
  jobId,
  from,
  crews,
  onMove,
}: {
  jobId: string;
  from: string;
  crews: PlanRoute[];
  onMove: (jobId: string, to: string) => void;
}) {
  return (
    <select
      aria-label={`Move ${jobId} to another crew`}
      value=""
      onChange={(e) => e.target.value && onMove(jobId, e.target.value)}
      className="rounded border border-app-border bg-app-surface px-1.5 py-1 text-[11px] text-app-text"
    >
      <option value="">Move to…</option>
      {crews
        .filter((c) => c.crew_id !== from)
        .map((c) => (
          <option key={c.crew_id} value={c.crew_id}>
            {c.crew_name} ({Math.round(c.target_pct)} %)
          </option>
        ))}
      {from !== UNASSIGNED && <option value={UNASSIGNED}>— Unassign</option>}
    </select>
  );
}

function dropHandlers(
  id: string,
  setDragOver: (v: string | null | ((cur: string | null) => string | null)) => void,
  onMove: (jobId: string, to: string) => void
) {
  return {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(id);
    },
    onDragLeave: () => setDragOver((cur) => (cur === id ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(null);
      const [jobId, from] = e.dataTransfer.getData("text/plain").split("::");
      if (jobId && from !== id) onMove(jobId, id);
    },
  };
}

function RouteCard({
  route,
  crews,
  crewNames,
  manualOrder,
  isDragOver,
  setDragOver,
  onMove,
  onReorder,
  onReoptimize,
}: {
  route: PlanRoute;
  crews: PlanRoute[];
  crewNames: Record<string, string>;
  manualOrder: boolean;
  isDragOver: boolean;
  setDragOver: (v: string | null | ((cur: string | null) => string | null)) => void;
  onMove: (jobId: string, to: string) => void;
  onReorder: (crewId: string, index: number, delta: -1 | 1) => void;
  onReoptimize: (crewId: string) => void;
}) {
  const pct = Math.min(100, route.target_pct);
  const onTarget = route.target_sek > 0 && route.revenue_sek >= route.target_sek;
  const overHours = route.total_hours > route.max_hours;
  const barColor = onTarget ? "bg-status-clear-fg" : route.target_pct >= 70 ? "bg-status-review-fg" : "bg-status-reschedule-fg";

  return (
    <section
      aria-label={`Route for ${route.crew_name}`}
      {...dropHandlers(route.crew_id, setDragOver, onMove)}
      className={[
        "flex flex-col rounded-lg border bg-app-surface shadow-sm transition-colors",
        isDragOver ? "border-brand ring-2 ring-brand/30" : "border-app-border",
      ].join(" ")}
    >
      <header className="border-b border-app-border p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-app-text">{route.crew_name}</h3>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {route.skills.map((s) => (
                <span key={s} className="rounded bg-app-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-app-text-muted">
                  {label(s)}
                </span>
              ))}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-lg font-semibold text-app-text">{kr(route.revenue_sek)}</div>
            <div className="text-[11px] text-app-text-muted">target {kr(route.target_sek)}</div>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Target size={13} className="shrink-0 text-app-text-muted" aria-hidden="true" />
          <div
            className="h-2 flex-1 overflow-hidden rounded-full bg-app-bg"
            role="progressbar"
            aria-valuenow={Math.round(route.target_pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Share of daily target"
          >
            <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
          <span className={`w-12 text-right font-mono text-xs font-medium ${onTarget ? "text-status-clear-fg" : "text-app-text"}`}>
            {Math.round(route.target_pct)} %
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-app-text-muted">
          <span className="flex items-center gap-1">
            <Car size={13} aria-hidden="true" /> {km(route.total_km)} · {hm(route.drive_minutes)}
          </span>
          <span className={`flex items-center gap-1 ${overHours ? "font-medium text-status-reschedule-fg" : ""}`}>
            <Clock size={13} aria-hidden="true" /> {route.total_hours} / {route.max_hours} h
            {route.finish_time && ` · home ${route.finish_time}`}
          </span>
          <span>fuel ≈ {kr(route.drive_cost_sek)}</span>
        </div>
      </header>

      <ol className="flex-1 divide-y divide-app-border">
        {route.stops.length === 0 && (
          <li className="p-4 text-center text-xs text-app-text-muted">
            No jobs — drop one here to give {route.crew_name} work.
          </li>
        )}
        {route.stops.map((stop, i) => (
          <StopRow
            key={stop.job_id}
            stop={stop}
            index={i}
            count={route.stops.length}
            crewId={route.crew_id}
            crews={crews}
            crewNames={crewNames}
            onMove={onMove}
            onReorder={onReorder}
          />
        ))}
      </ol>

      {route.stops.length > 0 && (
        <footer className="space-y-2 border-t border-app-border p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 text-app-text-muted">
            <span className="flex items-center gap-1">
              <Home size={13} aria-hidden="true" /> Back to base: {km(route.return_km)}
            </span>
            <div className="flex gap-2">
              {manualOrder && (
                <button
                  onClick={() => onReoptimize(route.crew_id)}
                  className="flex items-center gap-1 rounded border border-app-border px-2 py-1 font-medium text-app-text hover:bg-app-bg"
                >
                  <Wand2 size={12} /> Optimise order
                </button>
              )}
              {route.maps_url && (
                <a
                  href={route.maps_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded border border-app-border px-2 py-1 font-medium text-brand hover:bg-app-bg"
                >
                  <ExternalLink size={12} /> Google Maps
                </a>
              )}
            </div>
          </div>
          {route.warnings.length > 0 && (
            <ul className="space-y-0.5">
              {route.warnings.map((w) => (
                <li key={w} className="flex items-start gap-1 text-status-review-fg">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" /> {w}
                </li>
              ))}
            </ul>
          )}
        </footer>
      )}
    </section>
  );
}

function StopRow({
  stop,
  index,
  count,
  crewId,
  crews,
  crewNames,
  onMove,
  onReorder,
}: {
  stop: PlanStop;
  index: number;
  count: number;
  crewId: string;
  crews: PlanRoute[];
  crewNames: Record<string, string>;
  onMove: (jobId: string, to: string) => void;
  onReorder: (crewId: string, index: number, delta: -1 | 1) => void;
}) {
  const moved = stop.current_crew_id !== crewId;
  return (
    <li
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", `${stop.job_id}::${crewId}`)}
      className="group flex gap-2 p-3 hover:bg-app-bg/60"
    >
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-white">
          {index + 1}
        </span>
        <GripVertical size={14} className="cursor-grab text-app-text-muted opacity-0 group-hover:opacity-100" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-app-text-muted">
          ↳ {km(stop.leg_km)} · {hm(stop.leg_minutes)} drive
        </div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-medium text-app-text">{stop.address}</div>
            <div className="text-xs text-app-text-muted">
              <span className="font-mono">{stop.arrival}–{stop.departure}</span> · {stop.job_id} ·{" "}
              <span className="capitalize">{label(stop.job_type)}</span> · {stop.duration_hours} h
            </div>
          </div>
          <div className="shrink-0 text-right font-mono text-sm font-medium text-app-text">{kr(stop.price_sek)}</div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {stop.risk_level !== "green" && <StatusPill level={stop.risk_level} />}
          {moved && (
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
              {stop.current_crew_id ? `was ${crewNames[stop.current_crew_id] ?? stop.current_crew_id}` : "new assignment"}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button
              aria-label={`Move ${stop.job_id} earlier`}
              disabled={index === 0}
              onClick={() => onReorder(crewId, index, -1)}
              className="rounded border border-app-border p-1 text-app-text-muted hover:text-app-text disabled:opacity-30"
            >
              <ArrowUp size={12} />
            </button>
            <button
              aria-label={`Move ${stop.job_id} later`}
              disabled={index === count - 1}
              onClick={() => onReorder(crewId, index, 1)}
              className="rounded border border-app-border p-1 text-app-text-muted hover:text-app-text disabled:opacity-30"
            >
              <ArrowDown size={12} />
            </button>
            <MoveSelect jobId={stop.job_id} from={crewId} crews={crews} onMove={onMove} />
          </div>
        </div>
      </div>
    </li>
  );
}

function UnassignedCard({
  jobs,
  crews,
  crewNames,
  isDragOver,
  setDragOver,
  onMove,
}: {
  jobs: PlanUnassigned[];
  crews: PlanRoute[];
  crewNames: Record<string, string>;
  isDragOver: boolean;
  setDragOver: (v: string | null | ((cur: string | null) => string | null)) => void;
  onMove: (jobId: string, to: string) => void;
}) {
  return (
    <section
      aria-label="Jobs not assigned"
      {...dropHandlers(UNASSIGNED, setDragOver, onMove)}
      className={[
        "rounded-lg border border-dashed bg-app-surface p-3",
        isDragOver ? "border-brand ring-2 ring-brand/30" : "border-status-review-fg/50",
      ].join(" ")}
    >
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-app-text">
        <AlertTriangle size={15} className="text-status-review-fg" aria-hidden="true" />
        Not assigned ({jobs.length})
      </h3>
      <ul className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
        {jobs.map((job) => (
          <li
            key={job.job_id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/plain", `${job.job_id}::${UNASSIGNED}`)}
            className="cursor-grab rounded-md border border-app-border p-2.5 text-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-app-text">{job.address}</div>
                <div className="text-xs text-app-text-muted">
                  {job.job_id} · <span className="capitalize">{label(job.job_type)}</span> · {job.duration_hours} h
                  {job.current_crew_id && ` · saved: ${crewNames[job.current_crew_id] ?? job.current_crew_id}`}
                </div>
              </div>
              <span className="shrink-0 font-mono text-sm font-medium">{kr(job.price_sek)}</span>
            </div>
            <div className="mt-1 text-xs text-status-review-fg">{job.reason}</div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              {job.risk_level !== "green" ? <StatusPill level={job.risk_level} /> : <span />}
              <MoveSelect jobId={job.job_id} from={UNASSIGNED} crews={crews} onMove={onMove} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
