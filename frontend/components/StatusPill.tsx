import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { RiskLevel } from "@/lib/types";

const CONFIG: Record<
  RiskLevel,
  { label: string; fg: string; bg: string; Icon: typeof CheckCircle2 }
> = {
  green: { label: "Clear", fg: "text-status-clear-fg", bg: "bg-status-clear-bg", Icon: CheckCircle2 },
  amber: { label: "Review", fg: "text-status-review-fg", bg: "bg-status-review-bg", Icon: AlertTriangle },
  red: { label: "Reschedule", fg: "text-status-reschedule-fg", bg: "bg-status-reschedule-bg", Icon: XCircle },
};

export function StatusPill({ level }: { level: RiskLevel }) {
  const { label, fg, bg, Icon } = CONFIG[level];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${fg} ${bg}`}
    >
      <Icon size={13} strokeWidth={2.5} aria-hidden="true" />
      {label}
    </span>
  );
}
