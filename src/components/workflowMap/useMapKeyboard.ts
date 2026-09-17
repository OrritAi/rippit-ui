"use client";

import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { arrowTarget, rootOf } from "@/lib/workflowMap/model";
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
 *  - Keys follow the picture (`arrowTarget`, model.ts). → first unfolds a
 *    shut pill, a folded arm's card or a shut tile (`onExpand`), and ← first
 *    folds an open one (`onCollapse`), as a tree does. Otherwise the arrows
 *    move: along the viewed workflow's rows with ←/→ and between its lanes
 *    with ↑/↓ (↓ into the workflows a step calls); down a connected
 *    workflow's column with ↑/↓ and across to what a step calls with →/←.
 *    Home/End first/last in `model.flat`; Enter/Space = click
 *    (`onActivate`). Keyboard-driven focus also calls `focusNode` so the
 *    camera follows; mouse focus does not (the click handler centres on its
 *    own schedule).
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
  /** → on a folded pill, or on a card standing for a folded arm. */
  onExpand: (node: MapNode) => void;
  /** ← on an open pill, or on a card whose arm is drawn. */
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
/** Whether this item opens and closes, and whether it is currently open —
 *  a pill that can unfold, a route card standing for a folded arm, or a tile
 *  that opens in place. */
const openState = (n: MapNode): boolean | null =>
  canUnfold(n) ? !!n.pill?.open : n.fold ? n.fold.open : n.pack?.inPlace ? !!n.pack.open : null;
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
      const go = (target: MapNode | null | undefined) => {
        if (target && target !== node) moveFocus(target.id);
      };
      switch (e.key) {
        case "ArrowDown":
        case "ArrowUp":
          e.preventDefault();
          go(arrowTarget(model, node, e.key));
          break;
        case "ArrowRight":
          e.preventDefault();
          if (openState(node) === false) {
            onExpand(node);
            pendingFocus.current = null;
          } else go(arrowTarget(model, node, e.key));
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (openState(node) === true) onCollapse(node);
          else go(arrowTarget(model, node, e.key));
          break;
        case "Home":
          e.preventDefault();
          go(flat[0]);
          break;
        case "End":
          e.preventDefault();
          go(flat[flat.length - 1]);
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
    [model, flat, moveFocus, onActivate, onExpand, onCollapse]
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
      const open = openState(node);
      if (open !== null) props["aria-expanded"] = open;
      return props;
    },
    [tabTarget, selectedId, onKeyDown, onFocus]
  );

  return { focusId, itemProps, moveFocus };
}
