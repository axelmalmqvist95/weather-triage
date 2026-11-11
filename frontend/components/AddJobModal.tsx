"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Crew } from "@/lib/types";

interface Props {
  crews: Crew[];
  jobTypes: string[];
  onClose: () => void;
  onSubmit: (job: {
    job_id: string;
    date: string;
    time: string;
    latitude: number;
    longitude: number;
    address: string;
    job_type: string;
    duration_hours: number;
    crew_id: string | null;
    price_sek?: number | null;
  }) => Promise<void>;
}

const CITY_COORDS: Record<string, [number, number]> = {
  Malmö: [55.605, 13.0038],
  Lund: [55.7047, 13.191],
  Helsingborg: [56.0465, 12.6945],
  Göteborg: [57.7089, 11.9746],
  Stockholm: [59.3293, 18.0686],
  Uppsala: [59.8586, 17.6389],
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AddJobModal({ crews, jobTypes, onClose, onSubmit }: Props) {
  const [jobId, setJobId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState("09:00");
  const [city, setCity] = useState<keyof typeof CITY_COORDS>("Malmö");
  const [address, setAddress] = useState("");
  const [jobType, setJobType] = useState(jobTypes[0] ?? "");
  const [duration, setDuration] = useState(3);
  const [crewId, setCrewId] = useState<string>("");
  const [price, setPrice] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid = jobId.trim().length > 0 && address.trim().length > 0 && jobType.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    const [lat, lng] = CITY_COORDS[city];
    try {
      await onSubmit({
        job_id: jobId.trim(),
        date,
        time,
        latitude: lat,
        longitude: lng,
        address: `${address.trim()}, ${city}`,
        job_type: jobType,
        duration_hours: duration,
        crew_id: crewId || null,
        price_sek: price ? Number(price) : null,
      });
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-app-border bg-app-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-job-heading"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="add-job-heading" className="text-base font-semibold text-app-text">
            Add job
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-app-text-muted hover:bg-app-bg"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-app-text-muted">
            Job ID
            <input
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              placeholder="e.g. J2001"
              required
              className="rounded-md border border-app-border px-2 py-1.5 font-mono text-sm text-app-text"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-app-text-muted">
              Date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="rounded-md border border-app-border px-2 py-1.5 font-mono text-sm text-app-text"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-app-text-muted">
              Time
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
                className="rounded-md border border-app-border px-2 py-1.5 font-mono text-sm text-app-text"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-app-text-muted">
              City
              <select
                value={city}
                onChange={(e) => setCity(e.target.value as keyof typeof CITY_COORDS)}
                className="rounded-md border border-app-border px-2 py-1.5 text-sm text-app-text"
              >
                {Object.keys(CITY_COORDS).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-app-text-muted">
              Street address
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Storgatan 1"
                required
                className="rounded-md border border-app-border px-2 py-1.5 text-sm text-app-text"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-app-text-muted">
              Job type
              <select
                value={jobType}
                onChange={(e) => setJobType(e.target.value)}
                className="rounded-md border border-app-border px-2 py-1.5 text-sm capitalize text-app-text"
              >
                {jobTypes.map((t) => (
                  <option key={t} value={t}>
                    {t.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-app-text-muted">
              Duration (hours)
              <input
                type="number"
                min={1}
                max={12}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="rounded-md border border-app-border px-2 py-1.5 text-sm text-app-text"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium text-app-text-muted">
            Price, kr (optional — defaults to hourly rate × duration)
            <input
              type="number"
              min={0}
              step={50}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="e.g. 4500"
              className="rounded-md border border-app-border px-2 py-1.5 text-sm text-app-text"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-app-text-muted">
            Crew (optional)
            <select
              value={crewId}
              onChange={(e) => setCrewId(e.target.value)}
              className="rounded-md border border-app-border px-2 py-1.5 text-sm text-app-text"
            >
              <option value="">Unassigned</option>
              {crews.map((c) => (
                <option key={c.crew_id} value={c.crew_id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {error && <p className="text-xs text-status-reschedule-fg">{error}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-app-text-muted hover:bg-app-bg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isValid || submitting}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
            >
              {submitting ? "Adding…" : "Add job"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
