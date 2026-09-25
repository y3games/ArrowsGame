import type Phaser from 'phaser';
import { DIRECTION_DELTA, GAMEPLAY, headOf, type ArrowDTO } from '@arrows/shared';
import { cellToPosition, getCellSize } from './config.js';

export interface Point {
  x: number;
  y: number;
}

/** Centres of the arrow's cells, tail → head. */
export function bodyPoints(arrow: ArrowDTO): Point[] {
  return arrow.cells.map((cell) => cellToPosition(cell.row, cell.col));
}

/** Pixels from the head's centre to the board edge along its heading. */
function rayLength(arrow: ArrowDTO): number {
  const head = headOf(arrow);
  const { dr, dc } = DIRECTION_DELTA[arrow.dir];
  const cellsToEdge =
    dr < 0 ? head.row : dr > 0 ? GAMEPLAY.GRID_ROWS - 1 - head.row : dc < 0 ? head.col : GAMEPLAY.GRID_COLS - 1 - head.col;
  return (cellsToEdge + 0.5) * getCellSize();
}

function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return total;
}

export interface SlidePath {
  /** Body followed by a straight run off the board along the head's heading. */
  points: Point[];
  bodyLength: number;
  /** How far the snake travels until it is completely off the board. */
  travel: number;
}

export function slidePath(arrow: ArrowDTO): SlidePath {
  const body = bodyPoints(arrow);
  const bodyLength = pathLength(body);
  const head = body[body.length - 1]!;
  const { dr, dc } = DIRECTION_DELTA[arrow.dir];
  const size = getCellSize();
  // Far enough that the tail clears the edge, plus a little so no cap lingers on the border.
  const travel = rayLength(arrow) + bodyLength + size * 0.5;
  const run = travel + bodyLength;
  return { points: [...body, { x: head.x + dc * run, y: head.y + dr * run }], bodyLength, travel };
}

/** The part of a polyline between two distances measured from its start. */
export function subPath(points: Point[], from: number, to: number): Point[] {
  const out: Point[] = [];
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const segStart = walked;
    const segEnd = walked + len;
    walked = segEnd;
    if (len === 0 || segEnd < from || segStart > to) continue;
    const at = (d: number): Point => {
      const t = (Math.min(Math.max(d, segStart), segEnd) - segStart) / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    };
    if (out.length === 0) out.push(at(from));
    out.push(at(to));
  }
  return out;
}

/** Draws a snake through `points` (tail first) with a triangular head at the last point. */
export function drawSnake(g: Phaser.GameObjects.Graphics, points: Point[], color: number): void {
  g.clear();
  if (points.length === 0) return;
  const size = getCellSize();
  const thickness = size * 0.3;
  const headLength = size * 0.42;
  const headHalfWidth = size * 0.3;

  g.lineStyle(thickness, color, 1);
  g.fillStyle(color, 1);
  if (points.length > 1) g.strokePoints(points, false, false);
  // Round joints and caps, since Phaser strokes are drawn with butt ends.
  for (const p of points) g.fillCircle(p.x, p.y, thickness / 2);

  const tip = points[points.length - 1]!;
  const before = points[points.length - 2] ?? { x: tip.x, y: tip.y - 1 };
  const len = Math.hypot(tip.x - before.x, tip.y - before.y) || 1;
  const dx = (tip.x - before.x) / len;
  const dy = (tip.y - before.y) / len;
  const base = { x: tip.x - dx * headLength * 0.25, y: tip.y - dy * headLength * 0.25 };
  g.fillTriangle(
    base.x + dx * headLength, base.y + dy * headLength,
    base.x - dy * headHalfWidth, base.y + dx * headHalfWidth,
    base.x + dy * headHalfWidth, base.y - dx * headHalfWidth,
  );
}
