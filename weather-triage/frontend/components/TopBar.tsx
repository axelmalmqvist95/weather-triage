import { CloudSun } from "lucide-react";

export function TopBar({ jobCount, generatedAt }: { jobCount: number; generatedAt: string }) {
  return (
    <header className="border-b border-app-border bg-app-surface px-4 py-4 sm:px-6">
      <div className="flex items-center gap-2">
        <CloudSun size={20} className="text-brand" strokeWidth={2} />
        <span className="text-sm font-semibold text-app-text-muted">Weather Triage</span>
      </div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-app-text">
        Tomorrow&rsquo;s field schedule
      </h1>
      <p className="mt-0.5 text-sm text-app-text-muted">
        Generated {generatedAt} &middot; {jobCount} jobs assessed
      </p>
    </header>
  );
}
