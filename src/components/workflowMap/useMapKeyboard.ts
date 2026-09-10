"use client";

import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { rootOf } from "@/lib/workflowMap/model";
import type { MapModel, MapNode } from "@/lib/workflowMap/types";

/*
 * useMapKeyboard — WAI-ARIA tree keyboard behaviour over `model.flat`.
 *
 * Contract
 *  - The container carries `role="tree"`; each pill / step / route / marker
 *    element spreads `itemProps(node)` (role="treeitem", roving tabIndex,
 *    aria-level / aria-selected / aria-expanded, key + focus handlers). A
 *    children column carries `role="group"`. No nested buttons.
 *  - Roving tabindex: exactly one item is tabbable — the focused item, else
 *    the selected one, else the first in `model.flat`.
 *  - Keys: ↑/↓ previous/next in `model.flat` (render order); → unfolds a
 *    closed pill (`onExpand`) or enters the first child; ← folds an open pill
 *    (`onCollapse`) or exits to the parent; Home/End first/last;
 *    Enter/Space = click (`onActivate`). Keyboard-driven focus also calls
 *    `focusNode` so the camera follows; mouse focus does not (the click
 *    handler centres on its own schedule).
 *  - `elementOf(id)` returns the measured node element (the pill capsule or
 *    the card); the focusable tree item is that element or its
 *    `[role="treeitem"]` descendant — `focusable()` resolves it.
 *  - Windowed rows: when the target element is not mounted, `reveal(rootId)`
 *    scrolls its row into the window and the focus retries after the next
 *    model render.
 */

export interface TreeItemProps {
  role: "treeitem";
  tabIndex: 0 | -1;
  "aria-level": number;
  "aria-selected": boolean;
  "aria-expanded"?: boolean;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
}

export interface UseMapKeyboardOptions {
  model: MapModel;
  selectedId: string | null;
  /** Enter / Space — same as a click on the node. */
  onActivate: (node: MapNode) => void;
  /** → on a folded pill that can unfold. */
  onExpand: (node: MapNode) => void;
  /** ← on an open pill. */
  onCollapse: (node: MapNode) => void;
  elementOf: (id: string) => HTMLElement | null;
  /** Centre the camera on a node (keyboard focus only). */
  focusNode?: (id: string) => void;
  /** Bring a windowed root row into the window before focusing into it. */
  reveal?: (rootId: string) => void;
}

export interface MapKeyboard {
  focusId: string | null;
  /** Props for the element that represents `node`. */
  itemProps: (node: MapNode) => TreeItemProps;
  /** Programmatic focus (e.g. after a deep link resolves). */
  moveFocus: (id: string) => void;
}

const canUnfold = (n: MapNode) => !!n.pill && !n.pill.pinned && !n.pill.cycle && !n.pill.unavailable && !n.pill.error;
const focusable = (el: HTMLElement): HTMLElement =>
  el.getAttribute("role") === "treeitem" ? el : (el.querySelector<HTMLElement>('[role="treeitem"]') ?? el);

export function useMapKeyboard({
  model,
  selectedId,
  onActivate,
  onExpand,
  onCollapse,
  elementOf,
  focusNode,
  reveal,
}: UseMapKeyboardOptions): MapKeyboard {
  const [focusId, setFocusId] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const viaKeyboard = useRef(false);

  const { byId, flat } = model;
  const tabTarget =
    focusId != null && byId.has(focusId) ? focusId : selectedId != null && byId.has(selectedId) ? selectedId : (flat[0]?.id ?? null);

  const moveFocus = useCallback(
    (id: string) => {
      viaKeyboard.current = true;
      setFocusId(id);
      const el = elementOf(id);
      if (el) {
        focusable(el).focus({ preventScroll: true });
        focusNode?.(id);
        pendingFocus.current = null;
      } else {
        pendingFocus.current = id;
        reveal?.(rootOf(id));
      }
    },
    [elementOf, focusNode, reveal]
  );

  /* A windowed row became real (or a pill unfolded): land the pending focus. */
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id || !byId.has(id)) return;
    const el = elementOf(id);
    if (!el) return;
    pendingFocus.current = null;
    focusable(el).focus({ preventScroll: true });
    focusNode?.(id);
  }, [byId, elementOf, focusNode]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>, node: MapNode) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = flat.indexOf(node);
      const go = (i: number) => {
        const target = flat[Math.max(0, Math.min(flat.length - 1, i))];
        if (target && target !== node) moveFocus(target.id);
      };
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          go(idx + 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          go(idx - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (node.pill && !node.pill.open && canUnfold(node)) {
            onExpand(node);
            pendingFocus.current = null;
          } else if (node.children.length > 0) moveFocus(node.children[0].id);
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (node.pill?.open && canUnfold(node)) onCollapse(node);
          else if (node.parentId) moveFocus(node.parentId);
          break;
        case "Home":
          e.preventDefault();
          go(0);
          break;
        case "End":
          e.preventDefault();
          go(flat.length - 1);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          onActivate(node);
          break;
        default:
          return;
      }
    },
    [flat, moveFocus, onActivate, onExpand, onCollapse]
  );

  const onFocus = useCallback(
    (node: MapNode) => {
      setFocusId(node.id);
      if (viaKeyboard.current) focusNode?.(node.id);
      viaKeyboard.current = false;
    },
    [focusNode]
  );

  const itemProps = useCallback(
    (node: MapNode): TreeItemProps => {
      const props: TreeItemProps = {
        role: "treeitem",
        tabIndex: node.id === tabTarget ? 0 : -1,
        "aria-level": node.depth + 1,
        "aria-selected": node.id === selectedId,
        onKeyDown: (e) => onKeyDown(e, node),
        onFocus: () => onFocus(node),
      };
      if (node.pill && canUnfold(node)) props["aria-expanded"] = node.pill.open;
      return props;
    },
    [tabTarget, selectedId, onKeyDown, onFocus]
  );

  return { focusId, itemProps, moveFocus };
}
