import { Job } from "@/lib/types";
import { StatusPill } from "./StatusPill";

interface Props {
  job: Job;
  draggable?: boolean;
  onDragStart?: (jobId: string) => void;
  compact?: boolean;
}

export function JobCard({ job, draggable = false, onDragStart, compact = false }: Props) {
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", job.job_id);
        onDragStart?.(job.job_id);
      }}
      className={[
        "rounded-md border border-app-border bg-app-surface p-2.5 shadow-sm transition-shadow",
        draggable ? "cursor-grab active:cursor-grabbing hover:shadow-md" : "",
        compact ? "text-xs" : "text-sm",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono font-medium text-app-text">{job.job_id}</div>
          <div className="truncate text-app-text-muted">{job.address}</div>
        </div>
        <StatusPill level={job.risk_level} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-app-text-muted">
        <span className="capitalize">{job.job_type.replace("_", " ")}</span>
        <span className="font-mono">{job.time}</span>
      </div>
      {job.reasons.length > 0 && (
        <div className="mt-1.5 border-t border-app-border pt-1.5 text-app-text-muted">
          {job.reasons.join("; ")}
        </div>
      )}
    </div>
  );
}
