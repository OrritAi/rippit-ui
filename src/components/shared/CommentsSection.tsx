"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CornerDownRight, Trash2, Undo2 } from "lucide-react";
import {
  Comment,
  CommentTargetType,
  createComment,
  deleteComment,
  fetchComments,
  fetchMembers,
  patchComment,
  WorkspaceMember,
} from "@/app/lib/api";
import { useAuth } from "@/components/app/AuthProvider";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import { Section } from "@/components/shared/DetailPanelKit";
import { relativeTime } from "@/components/shared/RunsPanel";

/*
 * Threaded comments on one target (workflow / node / issue …). Composer
 * supports @mentions (type "@" → member suggestions; names with spaces are
 * quoted as @"Ana Lima"). Resolve/unresolve on the thread root (author or
 * workspace owner), delete own (or any, as owner). Optimistic-free: every
 * action re-reads from the server — comments are low-volume.
 */

function MentionInput({
  value,
  onChange,
  members,
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  members: WorkspaceMember[];
  placeholder: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const at = value.lastIndexOf("@");
  const query = at >= 0 && !/\s/.test(value.slice(at + 1)) ? value.slice(at + 1).toLowerCase() : null;
  const suggestions =
    query !== null
      ? members
          .filter((m) => (m.display_name || m.email || "").toLowerCase().includes(query))
          .slice(0, 5)
      : [];
  const pick = (m: WorkspaceMember) => {
    const handle = m.display_name
      ? m.display_name.includes(" ")
        ? `@"${m.display_name}"`
        : `@${m.display_name}`
      : `@${(m.email || "").split("@")[0]}`;
    onChange(value.slice(0, at) + handle + " ");
  };
  return (
    <div className="relative">
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full resize-y rounded-control border border-line bg-pill px-2.5 py-1.5 text-[12.5px] text-t1 placeholder:text-t3"
      />
      {suggestions.length > 0 && (
        <ul aria-label="Mention suggestions" className="absolute left-0 top-full z-20 mt-1 w-[240px] rounded-card border border-line bg-panel p-1 shadow-[0_12px_30px_var(--ambient)]">
          {suggestions.map((m) => (
            <li key={m.user_id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
                className="flex w-full items-center gap-2 rounded-control px-2 py-1 text-left text-[12.5px] hover:bg-hover"
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">{m.display_name || m.email}</span>
                {m.display_name && <span className="min-w-0 [overflow-wrap:anywhere] text-[11px] text-t3">{m.email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CommentsThread({
  targetType,
  targetKey,
  compact = false,
  onCountChange,
}: {
  targetType: CommentTargetType;
  targetKey: string;
  compact?: boolean;
  onCountChange?: (open: number, total: number) => void;
}) {
  const { user } = useAuth();
  const { current } = useWorkspace();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [gen, setGen] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const isOwner = current?.role === "owner";

  useEffect(() => {
    let live = true;
    fetchComments({ target: targetKey })
      .then((d) => {
        if (!live) return;
        setComments(d.comments);
        const c = d.counts[targetKey];
        onCountChange?.(c?.open ?? 0, c?.total ?? 0);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, gen]);

  useEffect(() => {
    if (!current) return;
    let live = true;
    fetchMembers(current.id)
      .then((d) => live && setMembers(d.members))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [current]);

  const threads = useMemo(() => {
    const roots = (comments ?? []).filter((c) => !c.parentId);
    const replies = new Map<string, Comment[]>();
    for (const c of comments ?? []) if (c.parentId) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), c]);
    return roots.map((r) => ({ root: r, replies: replies.get(r.id) ?? [] }));
  }, [comments]);

  const reload = () => setGen((g) => g + 1);

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    setError("");
    try {
      await createComment({ targetType, targetKey, body, parentId: replyTo });
      setDraft("");
      setReplyTo(null);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const canModerate = (c: Comment) => c.authorId === user?.id || isOwner;

  return (
    <div className="flex flex-col gap-2">
      {error && <p role="alert" className="text-[12px] text-err-text">{error}</p>}
      {comments && comments.length === 0 && (
        <p className="text-[12px] text-t3">No comments yet — start the thread below.</p>
      )}
      <ul className="flex flex-col gap-2">
        {threads.map(({ root, replies }) => (
          <li key={root.id} className={`rounded-control border border-line2 bg-panel px-2.5 py-2 ${root.resolvedAt ? "opacity-70" : ""}`}>
            <CommentBody c={root} canModerate={canModerate(root)} onChanged={reload} resolvable />
            {replies.length > 0 && (
              <ul className="mt-1.5 flex flex-col gap-1.5 border-l border-line2 pl-2.5">
                {replies.map((r) => (
                  <li key={r.id}>
                    <CommentBody c={r} canModerate={canModerate(r)} onChanged={reload} />
                  </li>
                ))}
              </ul>
            )}
            {!root.resolvedAt && (
              <button
                type="button"
                onClick={() => {
                  setReplyTo(root.id);
                  inputRef.current?.focus();
                }}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-t3 hover:text-t1"
              >
                <CornerDownRight aria-hidden="true" className="size-3" /> reply
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1">
        {replyTo && (
          <div className="flex items-center gap-2 text-[11px] text-t3">
            Replying in thread
            <button type="button" onClick={() => setReplyTo(null)} className="underline-offset-2 hover:underline">
              cancel
            </button>
          </div>
        )}
        <MentionInput
          value={draft}
          onChange={setDraft}
          members={members}
          placeholder={compact ? "Comment… (@ to mention)" : "Leave a note for your team — @ to mention someone"}
          inputRef={inputRef}
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-t3">Visible to everyone in this organization</span>
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim()}
            className="rounded-control border border-line px-2.5 py-1 text-[12px] font-semibold text-t2 hover:text-t1 disabled:opacity-50"
          >
            {replyTo ? "Reply" : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CommentBody({
  c,
  canModerate,
  onChanged,
  resolvable = false,
}: {
  c: Comment;
  canModerate: boolean;
  onChanged: () => void;
  resolvable?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-semibold text-t1">{c.authorName || "Someone"}</span>
        <span className="text-[11px] text-t3" title={new Date(c.createdAt).toLocaleString()}>
          {relativeTime(c.createdAt)}
          {c.editedAt ? " · edited" : ""}
        </span>
        {c.resolvedAt && (
          <span className="rounded-full border border-line px-1.5 py-[1px] text-[10px] font-semibold text-ok-text">resolved</span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {resolvable && canModerate && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await patchComment(c.id, { resolved: !c.resolvedAt }).catch(() => {});
                setBusy(false);
                onChanged();
              }}
              aria-label={c.resolvedAt ? "Reopen thread" : "Resolve thread"}
              title={c.resolvedAt ? "Reopen" : "Resolve"}
              className="text-t3 hover:text-t1"
            >
              {c.resolvedAt ? <Undo2 aria-hidden="true" className="size-3" /> : <Check aria-hidden="true" className="size-3" />}
            </button>
          )}
          {canModerate && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await deleteComment(c.id).catch(() => {});
                setBusy(false);
                onChanged();
              }}
              aria-label="Delete comment"
              title="Delete"
              className="text-t3 hover:text-err-text"
            >
              <Trash2 aria-hidden="true" className="size-3" />
            </button>
          )}
        </span>
      </div>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] text-t1">{renderMentions(c.body)}</p>
    </div>
  );
}

function renderMentions(body: string) {
  const parts = body.split(/(@"[^"]+"|@[A-Za-z0-9._+\-]+(?:@[A-Za-z0-9.\-]+)?)/g);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span key={i} className="rounded-[3px] px-0.5 font-semibold" style={{ background: "color-mix(in srgb, var(--warn) 14%, transparent)" }}>
        {p.replace(/^@"(.+)"$/, "@$1")}
      </span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

/** Panel section wrapper for node/issue targets. */
export function CommentsSection({ targetKey }: { targetKey: string | undefined }) {
  const [counts, setCounts] = useState<{ open: number; total: number } | null>(null);
  if (!targetKey) return null;
  const type: CommentTargetType = targetKey.startsWith("node:") ? "node" : targetKey.startsWith("issue:") ? "issue" : "workflow";
  return (
    <Section title={`Comments${counts ? ` · ${counts.open} open` : ""}`}>
      <CommentsThread targetType={type} targetKey={targetKey} compact onCountChange={(open, total) => setCounts({ open, total })} />
    </Section>
  );
}
