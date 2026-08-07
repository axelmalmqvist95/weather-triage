export type RiskLevel = "green" | "amber" | "red";

export interface Job {
  job_id: string;
  date: string; // ISO date
  time: string; // HH:MM
  latitude: number;
  longitude: number;
  address: string;
  job_type: string;
  duration_hours: number;
  crew_id: string | null;
  risk_level: RiskLevel;
  reasons: string[];
  suggested_reschedule_date: string | null;
}

export interface NewJobInput {
  job_id: string;
  date: string;
  time: string;
  latitude: number;
  longitude: number;
  address: string;
  job_type: string;
  duration_hours: number;
  crew_id: string | null;
}

export interface AssessmentSnapshot {
  snapshot_date: string;
  risk_level: RiskLevel;
  reasons: string[];
  suggested_reschedule_date: string | null;
  captured_at: string;
}

export interface Crew {
  crew_id: string;
  name: string;
  latitude: number;
  longitude: number;
  skills: string[];
}
