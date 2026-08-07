"use client";

import { useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { RiskLevel } from "@/lib/types";

const CONFIG: Record<RiskLevel, { label: string; fg: string; bg: string; Icon: typeof CheckCircle2 }> = {
  green: { label: "Clear", fg: "text-status-clear-fg", bg: "bg-status-clear-bg", Icon: CheckCircle2 },
  amber: { label: "Review", fg: "text-status-review-fg", bg: "bg-status-review-bg", Icon: AlertTriangle },
  red: { label: "Reschedule", fg: "text-status-reschedule-fg", bg: "bg-status-reschedule-bg", Icon: XCircle },
};

interface Props {
  level: RiskLevel;
  currentDate: string;
  suggestedDate: string | null;
  onReschedule: (newDate: string) => void;
}

export function RescheduleControl({ level, currentDate, suggestedDate, onReschedule }: Props) {
  const [open, setOpen] = useState(false);
  const [pendingDate, setPendingDate] = useState(suggestedDate ?? currentDate);
  const { label, fg, bg, Icon } = CONFIG[level];

  // GREEN jobs have nothing to act on — render a plain, non-interactive pill
  // rather than a button that would open a picker with no purpose.
  if (level === "green") {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${fg} ${bg}`}>
        <Icon size={13} strokeWidth={2.5} aria-hidden="true" />
        {label}
      </span>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80 ${fg} ${bg}`}
      >
        <Icon size={13} strokeWidth={2.5} aria-hidden="true" />
        {label}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-app-border bg-app-surface p-1 shadow-sm">
      <input
        type="date"
        value={pendingDate}
        onChange={(e) => setPendingDate(e.target.value)}
        aria-label={`New date for job, currently ${currentDate}`}
        className="rounded border border-app-border px-1.5 py-0.5 font-mono text-xs text-app-text"
      />
      <button
        onClick={() => {
          onReschedule(pendingDate);
          setOpen(false);
        }}
        className="rounded bg-brand px-2 py-0.5 text-xs font-medium text-white hover:bg-brand-hover"
      >
        Confirm
      </button>
      <button
        onClick={() => setOpen(false)}
        className="rounded px-2 py-0.5 text-xs font-medium text-app-text-muted hover:bg-app-bg"
      >
        Cancel
      </button>
    </div>
  );
}
