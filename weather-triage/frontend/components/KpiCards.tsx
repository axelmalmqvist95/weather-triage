import { Job } from "@/lib/types";

export function KpiCards({ jobs }: { jobs: Job[] }) {
  const counts = { green: 0, amber: 0, red: 0 };
  for (const job of jobs) counts[job.risk_level]++;

  const cards = [
    { label: "Clear to proceed", value: counts.green, color: "text-status-clear-fg" },
    { label: "Needs review", value: counts.amber, color: "text-status-review-fg" },
    { label: "Reschedule recommended", value: counts.red, color: "text-status-reschedule-fg" },
  ];

  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      role="status"
      aria-live="polite"
      aria-label={`${counts.green} jobs clear, ${counts.amber} need review, ${counts.red} need rescheduling`}
    >
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-app-border bg-app-surface p-4 shadow-sm">
          <div className={`font-mono text-3xl font-semibold ${c.color}`}>{c.value}</div>
          <div className="mt-1 text-xs font-medium uppercase tracking-wide text-app-text-muted">
            {c.label}
          </div>
        </div>
      ))}
    </div>
  );
}
