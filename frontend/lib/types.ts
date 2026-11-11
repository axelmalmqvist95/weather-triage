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
  price_sek: number;
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
  price_sek?: number | null;
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
  daily_target_sek: number;
  max_hours: number;
}

// ---- Route planning ----

interface PlanJobBase {
  job_id: string;
  address: string;
  job_type: string;
  latitude: number;
  longitude: number;
  duration_hours: number;
  scheduled_time: string;
  current_crew_id: string | null;
  price_sek: number;
  risk_level: RiskLevel;
  risk_reasons: string[];
}

export interface PlanStop extends PlanJobBase {
  arrival: string;
  departure: string;
  leg_km: number;
  leg_minutes: number;
}

export interface PlanUnassigned extends PlanJobBase {
  reason: string;
}

export interface PlanRoute {
  crew_id: string;
  crew_name: string;
  skills: string[];
  home_latitude: number;
  home_longitude: number;
  stops: PlanStop[];
  total_km: number;
  return_km: number;
  drive_minutes: number;
  work_hours: number;
  total_hours: number;
  max_hours: number;
  finish_time: string | null;
  revenue_sek: number;
  target_sek: number;
  target_pct: number;
  drive_cost_sek: number;
  warnings: string[];
  maps_url: string | null;
}

export interface Plan {
  date: string;
  routes: PlanRoute[];
  unassigned: PlanUnassigned[];
  total_revenue_sek: number;
  total_target_sek: number;
  total_km: number;
  crews_on_target: number;
  crews_working: number;
}

export interface PlanEdit {
  date: string;
  assignments: Record<string, string[]>;
  keep_order_for: string[];
}
