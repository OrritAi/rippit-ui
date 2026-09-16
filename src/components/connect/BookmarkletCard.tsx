"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUp, Bookmark, Check, Copy } from "lucide-react";
import { useOrigin } from "@/lib/use-origin";

/**
 * Installing the connect bookmarklet.
 *
 * **No browser lets a page add a bookmark.** `window.sidebar.addPanel`
 * (Firefox) and `window.external.AddFavorite` (IE) were removed years ago and
 * Chrome never shipped an equivalent — a page silently writing to the bookmarks
 * bar is precisely the abuse that was closed off. ⌘D bookmarks the *current*
 * page, not an arbitrary URL. So a drag, or a paste into a bookmark's URL
 * field, are the only two paths that exist; the one-click install is the
 * extension, which is a different vehicle.
 *
 * Given that, this component's whole job is to make the drag unmissable: one
 * target, an arrow saying where it goes, and the copy fallback in reach rather
 * than hidden behind a disclosure.
 *
 * **Why the href is set imperatively.** React strips `javascript:` URLs from
 * `href` ("React has blocked a javascript: URL as a security precaution"), so
 * passing it as a prop yields a bookmark that saves cleanly and then does
 * nothing. It is written to the DOM node instead, which React does not manage.
 */
export default function BookmarkletCard({ href }: { href: string }) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [copied, setCopied] = useState(false);
  const [clickedHere, setClickedHere] = useState(false);
  const [dragged, setDragged] = useState(false);
  const origin = useOrigin();
  const reduced = useReducedMotion();

  useEffect(() => {
    // Attribute, not property: React never sees it, so it survives re-renders
    // and is in place before a drag can start.
    linkRef.current?.setAttribute("href", href);
  }, [href]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — dragging still works */
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-center gap-2.5 rounded-card border border-dashed border-line-strong bg-hover px-4 pb-4 pt-3">
        <motion.div
          aria-hidden="true"
          className="flex items-center gap-1.5 text-[11.5px] font-medium text-t3"
          animate={reduced ? undefined : { y: [0, -3, 0] }}
          transition={
            reduced
              ? undefined
              : { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
          }
        >
          <ArrowUp className="size-3.5" />
          Drag up to your bookmarks bar
        </motion.div>

        {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- genuinely an
            anchor: only a real <a> with an href is draggable to the bookmarks
            bar. The href is set on the node (see above) because React strips
            javascript: URLs, which is what leaves it looking href-less here. */}
        <a
          ref={linkRef}
          draggable
          role="link"
          tabIndex={0}
          onDragStart={() => setDragged(true)}
          onClick={(e) => {
            e.preventDefault();
            setClickedHere(true);
          }}
          onKeyDown={(e) => {
            // Dragging is mouse-only, so the keyboard gets a real path rather
            // than a dead control.
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void copy();
            }
          }}
          className="inline-flex cursor-grab items-center gap-2 rounded-control bg-[var(--text)] px-4 py-2.5 text-[14px] font-semibold text-[var(--bg)] no-underline shadow-[var(--shadow-card)] active:cursor-grabbing"
        >
          <Bookmark aria-hidden="true" className="size-4" />
          Connect to Orrit
        </a>

        <button
          type="button"
          onClick={copy}
          className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-t3 underline underline-offset-2 hover:text-t2"
        >
          {copied ? (
            <>
              <Check aria-hidden="true" className="size-3" />
              Copied — paste it as a new bookmark’s URL
            </>
          ) : (
            <>
              <Copy aria-hidden="true" className="size-3" />
              Can’t drag? Copy the link instead
            </>
          )}
        </button>
      </div>

      {clickedHere && (
        <p role="status" className="text-[12.5px] text-warn-text">
          Nothing happens here — this button has to live on your bookmarks bar.
          Drag it up, then click it from there while GoHighLevel is open.
        </p>
      )}

      {dragged && !clickedHere && (
        <p role="status" className="text-[12.5px] text-ok-text">
          Dropped it on the bar? Open GoHighLevel, sign in, and click the
          bookmark — you’ll land back here.
        </p>
      )}

      <p className="text-[12px] leading-relaxed text-t3">
        Bookmarks bar hidden?{" "}
        <kbd className="rounded border border-line px-1 tabular">⌘⇧B</kbd> on Mac,{" "}
        <kbd className="rounded border border-line px-1 tabular">Ctrl+Shift+B</kbd>{" "}
        on Windows. The bookmark reads your GoHighLevel session and hands it to{" "}
        <span className="tabular">{origin || "Orrit"}</span> — it carries no
        Orrit credential and sends nothing anywhere else.
      </p>
    </div>
  );
}
