"use client";

import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import { Job } from "@/lib/types";

const MARKER_COLOR: Record<Job["risk_level"], string> = {
  green: "#15803D",
  amber: "#B45309",
  red: "#B91C1C",
};

export function RiskMap({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) return null;

  const center: [number, number] = [
    jobs.reduce((sum, j) => sum + j.latitude, 0) / jobs.length,
    jobs.reduce((sum, j) => sum + j.longitude, 0) / jobs.length,
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-app-border shadow-sm" style={{ height: 520 }}>
      <MapContainer center={center} zoom={7} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {jobs.map((job) => (
          <CircleMarker
            key={job.job_id}
            center={[job.latitude, job.longitude]}
            radius={7}
            pathOptions={{
              color: MARKER_COLOR[job.risk_level],
              fillColor: MARKER_COLOR[job.risk_level],
              fillOpacity: 0.75,
              weight: 2,
            }}
          >
            <Popup>
              <div className="font-mono text-xs font-semibold">{job.job_id}</div>
              <div className="text-xs">{job.address}</div>
              <div className="mt-1 text-xs capitalize">{job.job_type.replace("_", " ")}</div>
              <div className="text-xs">{job.date} {job.time}</div>
              {job.reasons.length > 0 && (
                <div className="mt-1 text-xs text-gray-600">{job.reasons.join("; ")}</div>
              )}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
