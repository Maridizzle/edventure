import type { Vector3 } from 'three';
import type { AreaTransform } from '../core/AreaTransform';
import type { PaintMask } from '../paint/PaintMask';
import type { Collectibles } from '../world/Collectibles';
import type { SceneDef } from '../content/types';
import { Minimap } from './Minimap';
import { cssHex, drawSilhouette } from './Silhouette';

/**
 * The two things he can read at a glance: where he is, and what he still has to
 * find.
 *
 * Both exist because the game was asking him to judge his own progress from a
 * 48 metre room he can see eight metres of. Neither contains a word, a number
 * or a letter: a map is a picture, a silhouette is a picture, and a border
 * closing is a picture.
 *
 * Top-left, deliberately. Top-right is permanently the grown-up hotspot, and
 * the bottom of a phone is where a five-year-old's hand lives.
 */

/** Everything the HUD reads. `PlayScene` satisfies this structurally. */
export interface HudScene {
  readonly mask: PaintMask;
  readonly transform: AreaTransform;
  readonly collectibles: Collectibles;
  readonly def: SceneDef;
  readonly playerPos: Vector3;
  readonly doorPos: Vector3;
  readonly gateProgress: number;
  readonly doorOpen: boolean;
}

/** Backing-store pixels per slot. CSS scales the row down on narrow phones. */
const SLOT = 56;
const GAP = 8;

/**
 * The map is drawn on a dark ground rather than the world's own drained gray.
 * The sky in here is a bright pink and a pale map on it is unreadable -- and a
 * map that cannot be read at a glance is worse than no map, because he will
 * stop looking at it.
 */
const MAP_DRAINED = 0x2a2f3a;
const MAP_PLAYER = 0xffffff;

export class Hud {
  private el: HTMLDivElement | null = null;
  private pips: HTMLCanvasElement | null = null;
  private pipCtx: CanvasRenderingContext2D | null = null;
  private map = new Minimap({
    painted: 0xffffff,
    drained: MAP_DRAINED,
    player: MAP_PLAYER,
    door: 0xffffff,
  });

  /**
   * Silhouettes live here, not in the scene: they are pure functions of a
   * recipe, they never change, and there are nine in the whole game.
   */
  private art = new Map<string, HTMLCanvasElement>();
  /** Which slots were filled last time, so the row only redraws on a change. */
  private lastState = '';
  private scene: HudScene | null = null;

  mount(parent: HTMLElement): void {
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.pips = document.createElement('canvas');
    this.pips.id = 'pips';
    this.pipCtx = this.pips.getContext('2d');
    this.el.append(this.map.canvas, this.pips);
    parent.appendChild(this.el);
  }

  /**
   * Point at a new room. Called inside the transition's swap, behind the opaque
   * fade, so the old room's shape never flashes on the way out.
   */
  setScene(scene: HudScene): void {
    this.scene = scene;
    this.map.setColours({
      painted: scene.def.palette.floorA,
      drained: MAP_DRAINED,
      player: MAP_PLAYER,
      door: scene.def.door.palette[0] ?? scene.def.palette.accent,
    });
    this.map.reset();
    this.lastState = '';
  }

  update(dtMs: number): void {
    const s = this.scene;
    if (!s || !this.el) return;

    this.map.update(
      dtMs,
      s.mask,
      s.transform,
      { x: s.playerPos.x, z: s.playerPos.z },
      { x: s.doorPos.x, z: s.doorPos.z },
      s.gateProgress,
      s.doorOpen,
    );

    // One character per slot. Cheap enough to build every frame for eight
    // items, and it means the row redraws exactly when something changes.
    const items = s.collectibles.items;
    let state = '';
    for (const h of items) state += h.found ? '1' : '0';
    if (state !== this.lastState) {
      this.lastState = state;
      this.drawPips();
    }
  }

  /**
   * One slot per hidden thing in THIS room.
   *
   * `items` and not the scene's authored list: the scene skips `given`
   * creatures and any whose placement failed, so the authored count would leave
   * a slot that can never be filled. A permanent empty slot is a small lie told
   * to a child who is counting, and he will keep looking for something that was
   * never there.
   */
  private drawPips(): void {
    const s = this.scene;
    const ctx = this.pipCtx;
    const canvas = this.pips;
    if (!s || !ctx || !canvas) return;

    const items = s.collectibles.items;
    const n = items.length;
    const w = Math.max(1, n * SLOT + Math.max(0, n - 1) * GAP);
    if (canvas.width !== w || canvas.height !== SLOT) {
      canvas.width = w;
      canvas.height = SLOT;
    }
    canvas.style.width = `${Math.round(w / 2)}px`;
    ctx.clearRect(0, 0, w, SLOT);

    for (let i = 0; i < n; i++) {
      const h = items[i]!;
      const x = i * (SLOT + GAP);

      ctx.save();
      ctx.translate(x, 0);
      ctx.beginPath();
      ctx.roundRect(0, 0, SLOT, SLOT, 14);
      ctx.fillStyle = h.found ? 'rgba(12,14,20,0.55)' : 'rgba(12,14,20,0.34)';
      ctx.fill();

      if (h.found) {
        ctx.drawImage(this.silhouette(h.def.id, h.def.shape, h.def.palette[0] ?? 0xffffff), 0, 0);
      } else {
        // A blank, NOT a greyed-out silhouette of the creature. Showing the
        // shape of a thing he has not found yet spoils every hidden object in
        // the room at once.
        ctx.beginPath();
        ctx.arc(SLOT / 2, SLOT / 2, SLOT * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private silhouette(
    id: string,
    shape: SceneDef['collectibles'][number]['shape'],
    hex: number,
  ): HTMLCanvasElement {
    const hit = this.art.get(id);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = SLOT;
    c.height = SLOT;
    const g = c.getContext('2d');
    if (g) drawSilhouette(g, shape, cssHex(hex), SLOT, 0.14);
    this.art.set(id, c);
    return c;
  }

  dispose(): void {
    this.map.dispose();
    this.pips?.remove();
    this.el?.remove();
    this.el = null;
    this.pips = null;
    this.pipCtx = null;
    this.art.clear();
  }
}
