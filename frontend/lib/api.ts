import { AssessmentSnapshot, Crew, Job, NewJobInput } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getJobs: () => request<Job[]>("/api/jobs"),
  getCrews: () => request<Crew[]>("/api/crews"),
  rescheduleJob: (jobId: string, newDate: string) =>
    request<Job>(`/api/jobs/${jobId}/reschedule`, {
      method: "POST",
      body: JSON.stringify({ new_date: newDate }),
    }),
  createJob: (job: NewJobInput) =>
    request<Job>("/api/jobs", {
      method: "POST",
      body: JSON.stringify(job),
    }),
  deleteJob: (jobId: string) =>
    fetch(`${API_BASE}/api/jobs/${jobId}`, { method: "DELETE" }).then((res) => {
      if (!res.ok) throw new Error(`DELETE /api/jobs/${jobId} failed: ${res.status}`);
    }),
  getJobHistory: (jobId: string) => request<AssessmentSnapshot[]>(`/api/jobs/${jobId}/history`),
};
