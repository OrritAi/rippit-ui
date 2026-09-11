import type { AdminStats } from "@/app/lib/api";

/** Four stat cards: organizations, seats, connections, open incidents. */
export function FleetStats({ stats }: { stats: AdminStats | null }) {
  const cells: [string, number | null][] = [
    ["organizations", stats?.organizations ?? null],
    ["seats", stats?.seats ?? null],
    ["connections", stats?.connections ?? null],
    ["open incidents", stats?.openIncidents ?? null],
  ];
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
      {cells.map(([label, value]) => (
        <div key={label} className="rounded-card border border-line bg-panel px-3.5 py-3">
          <p className="font-mono text-[10.5px] text-t3">{label}</p>
          <p className="tabular mt-0.5 text-[21px] font-bold tracking-[-0.02em]">{value == null ? "—" : value.toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}
