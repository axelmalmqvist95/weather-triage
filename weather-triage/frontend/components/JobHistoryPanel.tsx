"use client";

import { useEffect, useState } from "react";
import { X, History as HistoryIcon } from "lucide-react";
import { api } from "@/lib/api";
import { AssessmentSnapshot } from "@/lib/types";
import { StatusPill } from "./StatusPill";

interface Props {
  jobId: string;
  onClose: () => void;
}

export function JobHistoryPanel({ jobId, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<AssessmentSnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getJobHistory(jobId)
      .then(setSnapshots)
      .catch((err) => setError(String(err)));
  }, [jobId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[70vh] w-full max-w-md overflow-y-auto rounded-lg border border-app-border bg-app-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-heading"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="history-heading" className="flex items-center gap-1.5 text-base font-semibold text-app-text">
            <HistoryIcon size={16} />
            History &mdash; <span className="font-mono">{jobId}</span>
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-app-text-muted hover:bg-app-bg"
          >
            <X size={16} />
          </button>
        </div>

        {error && <p className="text-sm text-status-reschedule-fg">{error}</p>}

        {!error && snapshots === null && (
          <p className="text-sm text-app-text-muted">Loading history&hellip;</p>
        )}

        {snapshots?.length === 0 && (
          <p className="text-sm text-app-text-muted">
            No history yet — this job hasn&rsquo;t been assessed on a previous day.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {snapshots?.map((snap) => (
            <div
              key={snap.snapshot_date}
              className="rounded-md border border-app-border p-2.5 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-app-text-muted">{snap.snapshot_date}</span>
                <StatusPill level={snap.risk_level} />
              </div>
              {snap.reasons.length > 0 && (
                <p className="mt-1 text-xs text-app-text-muted">{snap.reasons.join("; ")}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
