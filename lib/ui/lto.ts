/**
 * LTO office estimate in plain words (only to help the approver judge the cash advance):
 * "about 25 km · usually 1 hour · suggested transport ₱600". Null when the office has no figures.
 */
export interface LtoFigures {
  distanceKm: number | null;
  travelHours: number | null;
  suggestedTransportCents: number | null;
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function ltoEstimate(o: LtoFigures | null | undefined): string | null {
  if (!o) return null;
  const parts = [
    o.distanceKm != null ? `about ${num(o.distanceKm)} km` : null,
    o.travelHours != null ? `usually ${num(o.travelHours)} hour${o.travelHours === 1 ? "" : "s"}` : null,
    o.suggestedTransportCents != null ? `suggested transport ₱${(o.suggestedTransportCents / 100).toLocaleString("en-PH", { maximumFractionDigits: 2 })}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** "LTO Mandaue · about 25 km · usually 1 hour" or "LTO Mandaue · No estimate yet". */
export const ltoLine = (o: (LtoFigures & { name: string }) | null | undefined) => (o ? `${o.name} · ${ltoEstimate(o) ?? "No estimate yet"}` : null);
