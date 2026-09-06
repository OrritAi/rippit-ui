"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Activity,
  ArrowUpRight,
  AtSign,
  Bell,
  Bookmark,
  Box,
  Clock3,
  Crosshair,
  Inbox,
  LayoutDashboard,
  Link2,
  Network,
  Search,
  Settings,
  SunMoon,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { useConnections, useWorkflowIndex } from "@/components/app/ConnectionsProvider";
import { usePalette } from "./palette-context";
import { getConnector } from "@/lib/connectors";
import { workflowHref } from "@/lib/portals";
import { fetchViews, SavedView, searchEstate, SearchHit } from "@/app/lib/api";
import { kindLabel, assetHref } from "@/components/shared/AssetsSection";
import { useTags } from "@/components/tags/tags-context";
import { TagChip } from "@/components/tags/TagChip";
import { AppPuck } from "@/components/shared/AppPuck";
import { Kbd } from "@/components/shell/Kbd";
import { useRecentWorkflows } from "@/lib/stored";

/*
 * ⌘K action hub. Actions for the page you're on come first, then jumps
 * (pages), workflows, steps & assets (server search from 2 chars), tags,
 * views, recents. cmdk does the filtering/keyboard; the look is the
 * handoff's 540px hub.
 */
const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_MIN_CHARS = 2;

function useServerSearch(query: string, enabled: boolean) {
  const [result, setResult] = useState<{ q: string; hits: SearchHit[]; failed?: boolean } | null>(null);
  const q = query.trim();
  useEffect(() => {
    if (!enabled || q.length < SEARCH_MIN_CHARS) return;
    let live = true;
    const t = setTimeout(() => {
      searchEstate(q, 15)
        // A failed request is not "no results" — carry the query and a failed
        // flag so the UI can offer a retry instead of implying an empty estate.
        .then((r) => live && setResult({ q, hits: r.results }))
        .catch(() => live && setResult({ q, hits: [], failed: true }));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, enabled]);
  if (!enabled || q.length < SEARCH_MIN_CHARS) return { hits: [], pending: false, failed: false };
  const current = result?.q === q ? result : null;
  return { hits: current?.hits ?? [], pending: !current, failed: !!current?.failed };
}

function hitHref(h: SearchHit): string {
  if (h.type === "tag" && h.tagId) return `/dashboard?tag=${encodeURIComponent(h.tagId)}`;
  if (h.type === "asset" && h.kind && h.value) return assetHref(h.kind, h.value);
  if (!h.provider || !h.workflowExternalId) return "/dashboard";
  const base = workflowHref({ source: h.provider, refId: h.workflowExternalId });
  return h.nodeId ? `${base}?step=${encodeURIComponent(h.nodeId)}` : base;
}

const PAGES: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/dashboard", label: "Go to dashboard", icon: LayoutDashboard },
  { href: "/w", label: "Workflows", icon: Workflow },
  { href: "/map", label: "System map", icon: Network },
  { href: "/assets", label: "Assets", icon: Link2 },
  { href: "/inbox", label: "Needs you", icon: Inbox },
  { href: "/activity", label: "Open notifications", icon: Bell },
  { href: "/mentions", label: "Mentions & comments", icon: AtSign },
  { href: "/settings/connections", label: "Settings", icon: Settings },
  { href: "/monitor", label: "Monitor (preview — sample data)", icon: Activity },
];

function IconBox({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="inline-flex size-6 flex-none items-center justify-center rounded-[6px] border border-line bg-hover text-t2">
      <Icon aria-hidden="true" className="size-3" />
    </span>
  );
}

const ITEM = "h-9 gap-2.5 rounded-[7px] px-[9px] text-[13.5px] text-t1 data-[selected=true]:bg-hover";

export function CommandPalette() {
  const router = useRouter();
  const { isOpen, setOpen, close, scope } = usePalette();
  const { connections, linkMap } = useConnections();
  const index = useWorkflowIndex();
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const { hits, pending, failed } = useServerSearch(query, isOpen);
  const { tags } = useTags();
  const recent = useRecentWorkflows();
  const [views, setViews] = useState<SavedView[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    let live = true;
    fetchViews().then((d) => live && setViews(d.views)).catch(() => {});
    return () => {
      live = false;
    };
  }, [isOpen]);

  const byConnection = useMemo(() => connections.map((conn) => ({ conn, entries: index.filter((e) => e.connectionId === conn.id) })), [connections, index]);

  const linkNames = useMemo(() => {
    if (!linkMap) return [];
    const nameOf = (ref: { source: string; refId: string }) => linkMap.workflows.find((w) => w.source === ref.source && w.refId === ref.refId)?.name || `${ref.source}:${ref.refId}`;
    return linkMap.links.map((l, i) => ({ key: `${i}:${l.from.source}:${l.from.refId}:${l.to.refId}`, from: l.from, label: `${nameOf(l.from)} → ${nameOf(l.to)}`, kind: l.kind, dead: l.status === "dead" }));
  }, [linkMap]);

  const go = (href: string) => {
    close();
    router.push(href);
  };
  const empty = query.trim().length === 0;

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={setOpen}
      title="Action hub"
      description="Act on the current workflow, or jump anywhere: workflows, steps, assets, pages"
      className="w-[540px] max-w-[calc(100%-48px)] rounded-card border-line bg-pill shadow-[var(--shadow-float)] anim-pop-in"
    >
      <div className="flex items-center gap-2.5 border-b border-line2 px-3.5">
        <Zap aria-hidden="true" className="size-3.5 flex-none text-t3" />
        <CommandInput placeholder={scope ? `Act on ${scope.label} — or jump anywhere` : "Jump anywhere — workflows, steps, assets, pages"} value={query} onValueChange={setQuery} className="h-[46px] text-[14px]" wrapperClassName="flex-1 border-0 px-0" hideIcon />
        <Kbd>esc</Kbd>
      </div>
      <CommandList className="max-h-[330px] p-1.5">
        <CommandEmpty>
          {pending
            ? "Searching…"
            : failed
              ? "Search didn’t respond. Check your connection and try again."
              : "No results — try a workflow, step, asset, or page."}
        </CommandEmpty>

        {scope?.actions && scope.actions.length > 0 && (
          <CommandGroup heading="Actions">
            {scope.actions.map((a) => (
              <CommandItem
                key={a.id}
                value={`action ${a.label}`}
                className={ITEM}
                onSelect={() => {
                  close();
                  a.run();
                }}
              >
                <IconBox icon={Zap} />
                <span className="flex-1 truncate">{a.label}</span>
                {a.hint && <CommandShortcut className="font-mono text-[9.5px]">{a.hint}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {hits.length > 0 && (
          <CommandGroup heading="Steps & assets">
            {hits
              .filter((h) => h.type !== "workflow" && h.type !== "tag")
              .map((h) => {
                const connector = h.provider ? getConnector(h.provider) : null;
                return (
                  <CommandItem key={`${h.type}:${h.provider}:${h.workflowExternalId}:${h.nodeId ?? ""}:${h.value ?? ""}`} value={`${query} ${h.type} ${h.label ?? ""} ${h.workflowName ?? ""}`} className={ITEM} onSelect={() => go(hitHref(h))}>
                    <IconBox icon={h.type === "asset" ? Box : Search} />
                    <span className="truncate">{h.label}</span>
                    <span className="min-w-0 flex-1 text-[11.5px] text-t2">
                      <span className="block truncate font-medium">{h.workflowName || "Workflow name unavailable"}</span>
                      <span className="block truncate text-t3">{[h.provider === "make" ? "Make" : h.provider === "ghl" ? "GoHighLevel" : null, h.connectionLabel, h.type === "asset" ? kindLabel(h.kind ?? "") : h.ordinal ? `Step ${h.ordinal}` : h.secondary].filter(Boolean).join(" · ")}</span>
                    </span>
                    <CommandShortcut className="font-mono text-[9.5px]">{h.type === "asset" ? "asset" : `${connector?.nouns.step ?? "step"}${h.ordinal ? ` ${h.ordinal}` : ""}`}</CommandShortcut>
                  </CommandItem>
                );
              })}
          </CommandGroup>
        )}

        {scope && scope.nodes.length > 0 && (
          <CommandGroup heading={`On this canvas · ${scope.label}`}>
            {scope.nodes.map((n) => (
              <CommandItem
                key={String(n.id)}
                value={`focus ${n.label} ${String(n.id)}`}
                className={ITEM}
                onSelect={() => {
                  scope.onSelect(n.id);
                  close();
                }}
              >
                <IconBox icon={Crosshair} />
                <span className="truncate">{n.label}</span>
                <CommandShortcut className="font-mono text-[9.5px]">focus</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Jump to">
          {PAGES.map((p) => (
            <CommandItem key={p.href} value={`page ${p.label}`} className={ITEM} onSelect={() => go(p.href)}>
              <IconBox icon={p.icon} />
              {p.label}
            </CommandItem>
          ))}
          <CommandItem
            value="toggle theme light dark"
            className={ITEM}
            onSelect={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
              close();
            }}
          >
            <IconBox icon={SunMoon} />
            Toggle theme
          </CommandItem>
        </CommandGroup>

        {empty && recent.length > 0 && (
          <CommandGroup heading="Recent">
            {recent.slice(0, 6).map((r) => (
              <CommandItem key={`${r.provider}:${r.id}`} value={`recent ${r.name}`} className={ITEM} onSelect={() => go(`/w/${r.provider}/${r.id}`)}>
                <IconBox icon={Clock3} />
                <span className="truncate">{r.name}</span>
                <CommandShortcut className="font-mono text-[9.5px]">{getConnector(r.provider).shortLabel}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {views.length > 0 && (
          <CommandGroup heading="Views">
            {views.map((v) => (
              <CommandItem key={v.id} value={`view ${v.name}`} className={ITEM} onSelect={() => go(`/${v.kind === "unified" ? "map" : "dashboard"}?view=${encodeURIComponent(v.id)}`)}>
                <IconBox icon={Bookmark} />
                <span className="truncate">{v.name}</span>
                <CommandShortcut className="font-mono text-[9.5px]">{v.kind === "unified" ? "map" : "dashboard"}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {tags.length > 0 && (
          <CommandGroup heading="Tags">
            {tags.map((t) => (
              <CommandItem key={t.id} value={`tag ${t.name}`} className={ITEM} onSelect={() => go(`/dashboard?tag=${encodeURIComponent(t.id)}`)}>
                <TagChip tag={t} size="xs" />
                <span className="text-[11.5px] text-t3">{t.workflows ?? 0} workflows</span>
                <CommandShortcut className="font-mono text-[9.5px]">filter</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {byConnection.map(({ conn, entries }) => {
          if (entries.length === 0) return null;
          const connector = getConnector(conn.provider);
          return (
            <CommandGroup key={conn.id} heading={`${connector.shortLabel} · ${conn.displayName}`}>
              {entries.map((e) => (
                <CommandItem key={`${e.provider}:${e.refId}`} value={`${e.name} ${e.groupPath.join(" ")} ${connector.label}`} className={ITEM} onSelect={() => go(workflowHref({ source: e.provider, refId: e.refId }))}>
                  <AppPuck app={e.provider} size={20} />
                  <span className="truncate">{e.name}</span>
                  {e.groupPath.length > 0 && <span className="truncate text-[11.5px] text-t3">{e.groupPath.join(" / ")}</span>}
                  <CommandShortcut className="font-mono text-[9.5px]">{connector.shortLabel}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}

        {linkNames.length > 0 && (
          <CommandGroup heading="Cross-platform links">
            {linkNames.map((l) => (
              <CommandItem key={l.key} value={`link ${l.label}`} className={ITEM} onSelect={() => go(workflowHref({ source: l.from.source, refId: l.from.refId }))}>
                <IconBox icon={l.dead ? ArrowUpRight : Link2} />
                <span className={`truncate ${l.dead ? "text-err-text" : ""}`}>{l.label}</span>
                <CommandShortcut className="font-mono text-[9.5px]">{l.dead ? "broken" : l.kind === "subflow" ? "subflow" : "webhook"}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="flex items-center gap-3 border-t border-line2 px-3.5 py-[7px] font-mono text-[10px] text-t3">
        <span>↑↓ navigate</span>
        <span>↵ run</span>
        <span className="ml-auto">⌘K</span>
      </div>
    </CommandDialog>
  );
}
