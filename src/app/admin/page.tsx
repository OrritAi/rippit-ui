"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { AdminOrgRow, AdminStats, fetchAdminOrganizations, fetchAdminStats } from "@/app/lib/api";
import { FleetStats } from "@/components/admin/FleetStats";
import { OrgPanel } from "@/components/admin/OrgPanel";
import { OrgTable, ownerOf } from "@/components/admin/OrgTable";
import { Segmented } from "@/components/shared/Segmented";
import { Input } from "@/components/ui/input";
import { errorText } from "@/lib/feedback";

type Filter = "all" | "active" | "suspended";

/*
 * Fleet view: stats, search + status filter, the organizations table, and
 * the detail panel for the selected row. Rows come down once and filter
 * locally; every change in the panel refetches both.
 */
export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [orgs, setOrgs] = useState<AdminOrgRow[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gen, setGen] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([fetchAdminOrganizations(), fetchAdminStats().catch(() => null)])
      .then(([o, s]) => {
        if (!live) return;
        setOrgs(o.organizations);
        setStats(s);
        setError("");
      })
      .catch((e) => live && setError(errorText(e, "The fleet couldn’t be loaded.")));
    return () => {
      live = false;
    };
  }, [gen]);

  const reload = useCallback(() => setGen((g) => g + 1), []);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (orgs ?? []).filter(
      (o) =>
        (filter === "all" || o.status === filter || (filter === "active" && o.status === "incident")) &&
        (!needle || o.name.toLowerCase().includes(needle) || ownerOf(o).toLowerCase().includes(needle))
    );
  }, [orgs, q, filter]);

  const selected = selectedId ? (orgs ?? []).find((o) => o.id === selectedId) ?? null : null;

  return (
    <>
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto outline-none">
        <div className="mx-auto flex w-full max-w-[980px] flex-col gap-5 px-6 pb-16 pt-6">
          <FleetStats stats={stats} />
          <div className="flex flex-wrap items-center gap-2.5">
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search organizations…"
              aria-label="Search organizations by name or owner email"
              className="h-9 min-w-[220px] max-w-[340px] flex-1 rounded-full border-line-strong bg-hover px-3.5 text-[13px] placeholder:text-t3 dark:bg-hover"
            />
            <Segmented<Filter>
              label="Filter by status"
              value={filter}
              options={[
                { value: "all", label: "All" },
                { value: "active", label: "Active" },
                { value: "suspended", label: "Suspended" },
              ]}
              onChange={setFilter}
            />
          </div>
          {error && (
            <p role="alert" className="text-[12.5px] text-err-text">
              {error}
            </p>
          )}
          <OrgTable rows={rows} selectedId={selectedId} onSelect={setSelectedId} loading={orgs === null && !error} />
        </div>
      </main>
      <AnimatePresence initial={false}>
        {selected && <OrgPanel key={selected.id} org={selected} onClose={() => setSelectedId(null)} onChanged={reload} />}
      </AnimatePresence>
    </>
  );
}
