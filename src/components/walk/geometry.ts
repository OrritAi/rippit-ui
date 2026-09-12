/*
 * The walk's world, as pure arithmetic.
 *
 * A fixed place with a moving camera: every stage stands at its own point and
 * never moves, and the world container translates by the inverse of the
 * current stage so that stage lands dead centre. That is what makes it read as
 * traversal rather than a slideshow — the cubes you already passed stay where
 * they were, behind you.
 *
 * The two sine pairs are the whole reason it does not read as a corridor. A
 * straight shaft was built and rejected ("the background is too plain"); with
 * these, stages sit high and low, left and right, and the rail between them
 * visibly turns. The frequencies are mutually irrational enough that no short
 * run of stages repeats a shape.
 *
 * Pure and dependency-free, so it can be unit-checked the way
 * `lib/workflowMap/model.ts` is.
 */

/** Z-spacing between consecutive stages. */
export const GAP = 620;

/** Cube edge: the stage you are standing at, and every other. */
export const SIZE_HERE = 168;
export const SIZE_BEYOND = 132;

/** Resting camera depth, and the shorter one a step transition kicks from —
 *  a brief narrowing that reads as a dolly rather than a cut. */
export const PERSPECTIVE = 900;
export const PERSPECTIVE_KICK = 760;

/** Auto-walk dwell per stage. */
export const STEP_MS = 1400;

/** Eye height: the world sits this far below the camera so cubes are read
 *  slightly from above, like standing among them rather than floating. */
const EYE = 130;

export function stageX(i: number): number {
  return Math.sin(i * 1.15) * 620 + Math.sin(i * 2.7) * 120;
}

export function stageY(i: number): number {
  return Math.cos(i * 0.8) * 170 + Math.sin(i * 1.9) * 60;
}

export function stageZ(i: number): number {
  return -i * GAP;
}

/** Where one stage stands, in world space. Never depends on the camera. */
export function stageTransform(i: number): string {
  return `translate3d(${stageX(i)}px, ${stageY(i) - EYE}px, ${stageZ(i)}px)`;
}

/** The inverse offset that brings stage `i` to the centre of the view. */
export function worldTransform(i: number): string {
  return `translate3d(${-stageX(i)}px, ${EYE - stageY(i)}px, ${i * GAP}px)`;
}

/** The rail joining two stages: a thin plane rotated into the shaft between
 *  them. Length is the true 3-D distance so the rail meets both cubes, and the
 *  two rotations aim it — yaw across the floor, pitch up or down. */
export function railBetween(i: number): {
  transform: string;
  length: number;
} {
  const dx = stageX(i + 1) - stageX(i);
  const dy = stageY(i + 1) - stageY(i);
  const dz = stageZ(i + 1) - stageZ(i);
  const flat = Math.sqrt(dx * dx + dz * dz);
  const length = Math.sqrt(flat * flat + dy * dy);
  const yaw = Math.atan2(dx, -dz) * (180 / Math.PI);
  const pitch = Math.atan2(dy, flat) * (180 / Math.PI);
  return {
    length,
    transform: `${stageTransform(i)} rotateY(${yaw}deg) rotateX(${-pitch}deg) translateZ(${-length / 2}px)`,
  };
}

/** Face shading, as fractions of the app colour over the base. A real mass is
 *  lit from above: the top catches most, the bottom almost none, the sides sit
 *  between, and the back is darkest because you are seeing it through the
 *  object. Reading these as arbitrary would be a mistake — they are the only
 *  thing making a cube look like a cube without a light source. */
export const FACES = [
  { name: "front", rotate: "", shade: 0.62 },
  { name: "back", rotate: "rotateY(180deg)", shade: 0.3 },
  { name: "right", rotate: "rotateY(90deg)", shade: 0.42 },
  { name: "left", rotate: "rotateY(-90deg)", shade: 0.42 },
  { name: "top", rotate: "rotateX(90deg)", shade: 0.86 },
  { name: "bottom", rotate: "rotateX(-90deg)", shade: 0.18 },
] as const;

/** The near-black a cube's colour is mixed into. A literal by design: the
 *  cubes are lit objects in a void, not surfaces on a themed page, and a
 *  surface token would flip with the theme and destroy the shading. Noted in
 *  the design handoff as a deliberate exception to tokens-only. */
export const CUBE_BASE = "#05070d";
