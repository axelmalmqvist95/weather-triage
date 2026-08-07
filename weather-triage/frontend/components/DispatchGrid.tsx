"use client";

import { useMemo, useState } from "react";
import { Crew, Job } from "@/lib/types";
import { JobCard } from "./JobCard";

interface Props {
  jobs: Job[];
  crews: Crew[];
  days: string[]; // ISO dates, in display order
  onReschedule: (jobId: string, newDate: string) => void;
}

export function DispatchGrid({ jobs, crews, days, onReschedule }: Props) {
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);

  const jobsByCrewAndDate = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const job of jobs) {
      const key = `${job.crew_id ?? "unassigned"}::${job.date}`;
      const list = map.get(key) ?? [];
      list.push(job);
      map.set(key, list);
    }
    return map;
  }, [jobs]);

  return (
    <div>
      <p className="mb-2 text-xs text-app-text-muted">
        Drag a job card to a different day to reschedule it. Prefer keyboard or screen reader
        navigation? Use the <span className="font-medium">List</span> view — every job there has
        the same reschedule action as a focusable button.
      </p>
      <div className="overflow-x-auto rounded-lg border border-app-border bg-app-surface shadow-sm">
        <table className="w-full border-collapse" aria-label="Dispatch schedule by crew and day">
          <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-[140px] border-b border-r border-app-border bg-app-surface p-3 text-left text-xs font-medium uppercase tracking-wide text-app-text-muted">
              Crew
            </th>
            {days.map((day) => (
              <th
                key={day}
                className="min-w-[200px] border-b border-app-border p-3 text-left text-xs font-medium uppercase tracking-wide text-app-text-muted"
              >
                {new Date(day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {crews.map((crew) => (
            <tr key={crew.crew_id} className="align-top">
              <td className="sticky left-0 z-10 border-b border-r border-app-border bg-app-surface p-3">
                <div className="font-medium text-app-text">{crew.name}</div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {crew.skills.map((s) => (
                    <span
                      key={s}
                      className="rounded bg-app-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-app-text-muted"
                    >
                      {s.replace("_", " ")}
                    </span>
                  ))}
                </div>
              </td>
              {days.map((day) => {
                const cellKey = `${crew.crew_id}::${day}`;
                const cellJobs = jobsByCrewAndDate.get(cellKey) ?? [];
                const isDragOver = dragOverCell === cellKey;
                return (
                  <td
                    key={day}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverCell(cellKey);
                    }}
                    onDragLeave={() => setDragOverCell((k) => (k === cellKey ? null : k))}
                    onDrop={(e) => {
                      e.preventDefault();
                      const jobId = e.dataTransfer.getData("text/plain");
                      setDragOverCell(null);
                      if (jobId) onReschedule(jobId, day);
                    }}
                    className={[
                      "min-h-[80px] border-b border-app-border p-2 align-top transition-colors",
                      isDragOver ? "bg-brand/5 ring-1 ring-inset ring-brand" : "",
                    ].join(" ")}
                  >
                    <div className="flex flex-col gap-1.5">
                      {cellJobs.map((job) => (
                        <JobCard key={job.job_id} job={job} draggable compact />
                      ))}
                      {cellJobs.length === 0 && (
                        <div className="rounded-md border border-dashed border-app-border p-3 text-center text-[11px] text-app-text-muted">
                          &mdash;
                        </div>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
