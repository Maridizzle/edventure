import {
  Group,
  Mesh,
  Scene,
  Vector2,
  Vector3,
  type ShaderMaterial,
  type WebGLRenderer,
} from 'three';
import { AreaTransform } from '../core/AreaTransform';
import { makeNoiseTextureData } from '../core/Noise';
import { stream } from '../core/Rng';
import type { TierSettings } from '../core/Quality';
import { PaintMask } from '../paint/PaintMask';
import { createFieldTexture, createNoiseTexture, createPaintTexture } from '../paint/PaintTextures';
import { createGroundMaterial } from '../paint/GroundMaterial';
import { Terrain } from '../world/Terrain';
import { layoutScene, type LayoutResult } from '../world/Layout';
import { buildStage, type StageBuild } from '../world/Stage';
import { Props, TOUCH_SCRATCH } from '../world/Props';
import { computeReachable } from '../world/Reachability';
import { Collectibles, type FoundEvent } from '../world/Collectibles';
import { Motes } from './fx/Motes';
import { Shockwave } from './fx/Shockwave';
import { Explored } from '../world/Explored';
import { createSky } from '../world/Sky';
import type { AudioEngine } from '../core/Audio/AudioEngine';
import { SCALES } from '../core/Audio/Scale';
import { Door } from '../world/Door';
import { Character } from '../player/Character';
import { FollowCamera } from '../player/FollowCamera';
import { FLAVORS, makeMoveState, stepMotion, type MoveState } from '../player/Motion';
import { createSilhouetteMaterial, createToyMaterial } from '../shape/ToyMaterial';
import { createInstancedToyMaterial } from '../shape/InstancedToyMaterial';
import { blob } from '../content/characters/blob';
import { candy } from '../content/scenes/candy';
import type { SceneDef } from '../content/types';

const NOISE_SIZE = 128;

/** Touching a prop splashes this much ground around it. */
const PROP_SPLASH_M = 5.0;

/**
 * Coverage weighting. Props are worth a lot because bumping things is the fun
 * part, and the fun part should also be the fast route to a finished room.
 */
const GROUND_WEIGHT = 0.6;
const PROP_WEIGHT = 0.4;

/**
 * How painted a room must be before the way out opens.
 *
 * Deliberately low. More rooms beats longer rooms at five: a new place
 * arriving every couple of minutes is what holds him, and each new room is
 * another set of hidden things. Never 1.0 -- requiring a perfectly painted
 * floor would turn a no-fail game into a grind.
 */
const GATE = 0.5;

/**
 * How far he can see. Generous on purpose: a small child alone inside a tight
 * fog bank is frightening rather than mysterious, and the fog is the sky's
 * colour so it reads as haze, never as darkness.
 */
const FOG_CLEAR_M = 8.5;
const FOG_FULL_M = 17;

/** Seconds between idle sparkles on already-painted things. */
const TWINKLE_EVERY = 0.55;

/**
 * Haptics, only once the page has genuinely been interacted with. Chrome logs
 * a console error for a vibrate before user activation, and it is absent on
 * iOS entirely -- neither is worth a crash over a nicety.
 */
function buzz(): void {
  const nav = navigator as Navigator & { userActivation?: { hasBeenActive: boolean } };
  if (nav.userActivation && !nav.userActivation.hasBeenActive) return;
  try {
    nav.vibrate?.(12);
  } catch {
    /* unsupported */
  }
}

export class PlayScene {
  readonly scene = new Scene();
  readonly follow: FollowCamera;

  readonly def: SceneDef;
  readonly terrain: Terrain;
  readonly transform: AreaTransform;
  readonly mask: PaintMask;
  readonly props: Props;

  private groundMat: ShaderMaterial;
  private toyMat: ShaderMaterial;
  private playerMat: ShaderMaterial;
  private doorMat: ShaderMaterial;
  private silhouetteMat: ShaderMaterial;
  private instMat: ShaderMaterial;
  private paintTex;
  private fieldTex;
  private noiseTex;

  private stage: StageBuild;
  private door: Door;
  private worldGroup = new Group();

  private player: Character;
  private move: MoveState;
  private prevCellX = 0;
  private prevCellZ = 0;

  readonly explored: Explored;
  readonly collectibles: Collectibles;
  private field: Uint8Array;
  private found: FoundEvent[] = [];
  private motes: Motes;
  private shockwave: Shockwave;
  private sky;
  private twinkleTimer = 0;
  private fogCenter = new Vector2();

  private time = 0;
  private frameIndex = 0;
  private settings: TierSettings;
  private layout: LayoutResult;

  /** Fires once he walks through the open door. */
  onExit: (() => void) | null = null;
  private exited = false;
  private readonly audio: AudioEngine;

  constructor(
    seed: number,
    settings: TierSettings,
    aspect: number,
    audio: AudioEngine,
    def: SceneDef = candy,
  ) {
    this.def = def;
    this.settings = settings;
    this.audio = audio;

    const size = def.stage.width;
    const t = def.stage.terrain;

    this.terrain = new Terrain(
      {
        worldSize: size,
        grid: settings.terrainGrid,
        octaves: def.stage.floor === 'flat' ? [] : (t?.octaves ?? []),
        warpFreq: t?.warp.freq ?? 0.01,
        warpAmp: t?.warp.amp ?? 0,
        maxSlopeDeg: t?.maxSlopeDeg ?? 26,
        // A room's floor must not fall away at the rim; the walls bound it.
        edgeFalloff: def.stage.floor === 'flat' ? null : { start: 0.8, power: 2 },
      },
      seed,
    );

    this.transform = AreaTransform.centered(size, settings.maskCells);
    this.mask = new PaintMask(settings.maskCells);
    this.mask.setAllPaintable();

    // --- textures ---
    this.paintTex = createPaintTexture(this.mask);
    const field = new Uint8Array(settings.maskCells * settings.maskCells * 2);
    for (let i = 0; i < settings.maskCells * settings.maskCells; i++) field[i * 2] = 255;
    this.field = field;
    this.fieldTex = createFieldTexture(field, settings.maskCells);
    this.noiseTex = createNoiseTexture(
      makeNoiseTextureData(NOISE_SIZE, stream(seed, 'noisetex')),
      NOISE_SIZE,
    );

    // --- sky + fog ---
    this.explored = new Explored(size);
    this.sky = createSky(def.sky.top, def.sky.horizon);
    this.scene.add(this.sky);

    const lightDir = new Vector3(...def.light.dir).normalize();
    // Radial, player-centred fog replaces three's camera-distance fog entirely.
    const mask = this.transform.uniforms();
    const fogArgs = {
      fogColor: def.sky.fogColor,
      fogNear: FOG_CLEAR_M,
      fogFar: FOG_FULL_M,
      paintTex: this.paintTex,
      exploredTex: this.explored.texture,
      maskOrigin: mask.uMaskOrigin,
      maskInvSize: mask.uMaskInvSize,
    };

    this.scene.add(this.worldGroup);

    // --- floor ---
    this.groundMat = createGroundMaterial({
      palette: {
        groundA: def.palette.floorA,
        groundB: def.palette.floorB,
        accent: def.palette.accent,
        grayTint: def.palette.grayTint,
      },
      transform: this.transform,
      fieldTex: this.fieldTex,
      noiseTex: this.noiseTex,
      heightMin: this.terrain.minHeight,
      heightRange: Math.max(0.001, this.terrain.maxHeight - this.terrain.minHeight),
      lightDir,
      ...fogArgs,
    });
    const ground = new Mesh(this.terrain.buildGeometry(), this.groundMat);
    ground.frustumCulled = false;
    this.worldGroup.add(ground);

    // --- shared materials ---
    // Walls, tray and door: drained until the floor beneath them is painted.
    this.toyMat = createToyMaterial({
      lightDir,
      grayTint: def.palette.grayTint,
      ...fogArgs,
    });
    // The player is always in colour and never fades into the fog -- losing
    // sight of yourself is the one thing fog must never do.
    this.playerMat = createToyMaterial({
      lightDir,
      grayTint: def.palette.grayTint,
      painted: true,
      selfLit: true,
      maxFog: 0,
      ...fogArgs,
    });
    // The door glows faintly through the haze as a permanent landmark.
    this.doorMat = createToyMaterial({
      lightDir,
      grayTint: def.palette.grayTint,
      maxFog: 0.7,
      ...fogArgs,
    });
    this.instMat = createInstancedToyMaterial({
      lightDir,
      grayTint: def.palette.grayTint,
      ...fogArgs,
    });

    // --- layout first: the wall needs to know where to leave the doorway ---
    this.layout = layoutScene(def, seed);

    // --- the diorama shell ---
    // The walls sample the floor mask beneath them, so colour climbs the room
    // as he paints along its edges.
    this.stage = buildStage(def, this.toyMat, this.layout.door.x);
    this.worldGroup.add(this.stage.group);

    this.props = new Props(
      def,
      this.layout.placed,
      this.terrain,
      this.instMat,
      this.worldGroup,
      settings.shapeDetail,
    );
    // Solid objects can enclose floor. Anything he cannot reach must drop out
    // of the coverage denominator, or the door's threshold becomes impossible
    // and a no-fail game acquires a dead end.
    this.mask.setPaintableFrom(
      computeReachable(
        this.transform,
        this.layout.placed,
        (pl) => {
          const d = pl.isScatter ? def.scatter[pl.defIndex]! : def.fixtures[pl.defIndex]!;
          return (d.solid ?? 0) * pl.scale;
        },
        this.layout.spawn,
        blob.radius,
      ),
    );

    // Hidden things, and the warmth field that guarantees he can find them.
    this.collectibles = new Collectibles(
      def,
      seed,
      this.terrain,
      this.layout.placed,
      this.props,
      this.instMat,
      this.worldGroup,
      settings.shapeDetail,
      size / 2,
    );
    this.collectibles.bakeWarmth(this.field, this.transform);
    this.fieldTex.needsUpdate = true;

    this.motes = new Motes(settings.particles);
    this.scene.add(this.motes.points);
    this.shockwave = new Shockwave();
    this.scene.add(this.shockwave.mesh);
    audio.setScene(def.audio.rootHz, SCALES[def.audio.scale] ?? undefined);

    this.door = new Door(
      def,
      this.doorMat,
      this.layout.door,
      this.terrain.heightAt(this.layout.door.x, this.layout.door.z),
      settings.shapeDetail,
    );
    this.worldGroup.add(this.door.group);

    // --- player ---
    this.silhouetteMat = createSilhouetteMaterial(blob.palette[0] ?? 0xffffff);
    this.player = new Character(blob, this.playerMat, settings.shapeDetail, this.silhouetteMat);
    this.worldGroup.add(this.player.group);

    this.move = makeMoveState(blob.radius);
    this.move.pos.set(this.layout.spawn.x, 0, this.layout.spawn.z);
    this.move.pos.y = this.terrain.heightAt(this.move.pos.x, this.move.pos.z) + blob.radius;
    this.prevCellX = this.transform.cellX(this.move.pos.x);
    this.prevCellZ = this.transform.cellZ(this.move.pos.z);

    this.follow = new FollowCamera(aspect);
    this.follow.reset(this.move.pos);
  }

  get doorOpen(): boolean {
    return this.door.isOpen;
  }

  /** 0..1. Ground and props combined; this is what opens the door. */
  get progress(): number {
    return GROUND_WEIGHT * this.mask.coverage + PROP_WEIGHT * this.props.coverage;
  }

  get coverage(): number {
    return this.mask.coverage;
  }

  fixedUpdate(input: Vector2, dt: number): void {
    stepMotion(
      this.move,
      blob.movement,
      input,
      this.terrain,
      this.def.stage.width,
      dt,
      (st) => this.props.resolveSolids(st.pos, st.vel, st.radius),
    );

    const flavor = FLAVORS[blob.movement.flavor];
    const cx = this.transform.cellX(this.move.pos.x);
    const cz = this.transform.cellZ(this.move.pos.z);
    const r = this.transform.radiusCells(blob.trail.radiusM * flavor.brushScale);

    if (flavor.stampPolicy === 'continuous') {
      this.mask.stampSegment(this.prevCellX, this.prevCellZ, cx, cz, r);
    } else if (this.move.justLanded) {
      this.mask.stamp(cx, cz, r);
    }
    this.prevCellX = cx;
    this.prevCellZ = cz;

    // Bumping things is the fun part, so it is also the fast way to fill a
    // room: every prop touched splashes a wide burst of floor paint.
    this.props.setTime(this.time);
    this.props.collectTouched(this.move.pos.x, this.move.pos.z, blob.radius, TOUCH_SCRATCH);
    for (let i = 0; i < TOUCH_SCRATCH.length; i++) {
      const p = TOUCH_SCRATCH[i]!;
      this.mask.stamp(
        this.transform.cellX(p.x),
        this.transform.cellZ(p.z),
        this.transform.radiusCells(PROP_SPLASH_M),
      );
      this.motes.burst(p.x, p.y + 0.9, p.z, 44, p.color, this.def.palette.accent);
      this.shockwave.fire(p.x, p.y + 0.15, p.z, p.color);
      this.audio.play(p.note);
      // Whatever was pretending to be this prop now hatches out of it.
      this.collectibles.onPropPainted(p.id, this.found);
    }

    this.collectibles.setTime(this.time);
    this.collectibles.checkProximity(this.move.pos.x, this.move.pos.z, blob.radius, this.found);
    for (let i = 0; i < this.found.length; i++) {
      const f = this.found[i]!;
      if (f.def.hide === 'disguise') {
        // The ordinary prop it was impersonating gets out of the way.
        for (const h of this.collectibles.items) {
          if (h.def === f.def && h.propId >= 0) this.props.hide(h.propId);
        }
      }
      // A find should feel bigger than painting a gumdrop.
      const c = f.def.palette[0] ?? 0xffffff;
      this.motes.burst(f.x, f.y + 1.2, f.z, 90, c, this.def.palette.accent, 9);
      this.shockwave.fire(f.x, f.y + 0.15, f.z, c);
      this.audio.play(f.def.note);
      this.mask.stamp(
        this.transform.cellX(f.x),
        this.transform.cellZ(f.z),
        this.transform.radiusCells(PROP_SPLASH_M * 1.6),
      );
      // The glow that led him here has done its job.
      this.collectibles.bakeWarmth(this.field, this.transform);
      this.fieldTex.needsUpdate = true;
      buzz();
    }
    this.found.length = 0;
    if (TOUCH_SCRATCH.length > 0) buzz();

    // Fog lifts wherever he has BEEN, not merely where he painted.
    this.explored.visit(this.move.pos.x, this.move.pos.z);

    // The room is done: open the way out, loudly.
    if (!this.door.isOpen && this.progress >= GATE) {
      this.door.open();
      this.celebrateDoor();
    }

    if (!this.exited && this.door.reached(this.move.pos.x, this.move.pos.z, blob.radius)) {
      this.exited = true;
      this.onExit?.();
    }

    this.player.update(this.move, dt);
  }

  render(renderer: WebGLRenderer, dt: number): void {
    this.time += dt;
    this.frameIndex++;

    this.mask.decayPulse();

    if (this.mask.dirty && this.frameIndex % this.settings.maskUploadInterval === 0) {
      this.paintTex.needsUpdate = true;
      this.mask.dirty = false;
    }

    this.groundMat.uniforms.uTime!.value = this.time;
    this.instMat.uniforms.uTime!.value = this.time;

    // Fog follows the child, not the camera.
    this.fogCenter.set(this.move.pos.x, this.move.pos.z);
    for (const m of [this.groundMat, this.toyMat, this.playerMat, this.doorMat, this.instMat]) {
      (m.uniforms.uFogCenter!.value as Vector2).copy(this.fogCenter);
    }

    if (this.door.update(dt)) this.beckon();
    this.motes.update(dt);
    this.shockwave.update(dt);
    this.explored.upload();

    // Painted things keep sparkling, so a finished room stays alive.
    this.twinkleTimer -= dt;
    if (this.twinkleTimer <= 0) {
      this.twinkleTimer = TWINKLE_EVERY;
      const t = this.props.randomPainted();
      if (t) this.motes.twinkle(t.x, t.y, t.z, t.color);
    }

    this.audio.setCoverage(this.progress);

    this.follow.update(dt, this.move.pos, this.move.vel, this.move.speedNorm, blob.face.lookAhead);
    renderer.render(this.scene, this.follow.camera);
  }

  /** Debug only: open the way out without painting the whole room first. */
  forceOpenDoor(): void {
    if (this.door.isOpen) return;
    this.door.open();
    this.celebrateDoor();
  }

  /** Debug only: throw a firework at the player so it can be photographed. */
  testBurst(): void {
    this.motes.burst(
      this.move.pos.x,
      this.move.pos.y + 1.0,
      this.move.pos.z,
      40,
      this.def.palette.floorA,
      this.def.palette.accent,
    );
    this.shockwave.fire(this.move.pos.x, this.move.pos.y - 0.4, this.move.pos.z, this.def.palette.accent);
  }

  /**
   * The moment the room is finished. Three signals at once, none of them a
   * word: colour, motion, and a rising phrase.
   */
  private celebrateDoor(): void {
    const d = this.door.position;
    const accent = this.def.palette.accent;
    this.motes.burst(d.x, d.y + 3.0, d.z, 110, this.def.door.palette[0] ?? accent, accent, 10);
    this.shockwave.fire(d.x, d.y + 0.2, d.z, accent);

    // The door is very probably OFF SCREEN when this fires -- the fog is tight
    // and the camera is low. So the moment has to also happen where he is
    // looking, or he finishes a room and never learns anything changed.
    this.motes.burst(this.move.pos.x, this.move.pos.y + 1.4, this.move.pos.z, 60, accent, accent, 7);
    this.shockwave.fire(this.move.pos.x, this.move.pos.y - 0.4, this.move.pos.z, accent);
    this.beckon();

    // A rising arpeggio, which in a pentatonic scale cannot come out wrong.
    for (const degree of [0, 2, 4, 7, 9]) this.audio.play([degree]);
    buzz();
  }

  /**
   * A ribbon of sparks running the WHOLE way from the door to the player.
   *
   * This is the entire "the way out is open, it is that way" instruction, and
   * it contains no words. It has to span the full distance: a trail that only
   * reaches a few metres from the door is invisible to a child standing on the
   * far side of a foggy room, which makes it decoration rather than direction.
   */
  private beckon(): void {
    const d = this.door.position;
    const dx = this.move.pos.x - d.x;
    const dz = this.move.pos.z - d.z;
    const n = 26;
    for (let i = 0; i < n; i++) {
      // Squared spacing bunches the sparks toward HIS end, so the near ones are
      // unmissable and the line still points back the way he must go.
      const t = Math.pow(i / (n - 1), 0.65);
      this.motes.twinkle(
        d.x + dx * t,
        d.y + 2.6 - t * 1.6,
        d.z + dz * t,
        this.def.palette.accent,
      );
    }
  }

  applySettings(s: TierSettings): void {
    this.settings.maskUploadInterval = s.maskUploadInterval;
    this.settings.particles = s.particles;
  }

  resize(w: number, h: number): void {
    this.follow.setAspect(w, h);
    this.motes.setPixelScale(h, this.follow.camera.fov);
  }

  /**
   * Scene switching is a new leak surface. Ten transitions crashes a 4 GB
   * phone if anything here is missed — watch renderer.info.memory.
   */
  /**
   * Give every GPU resource back.
   *
   * Ten room changes with anything missed crashes a 4 GB phone, and this path
   * only started running once rooms could be left -- so `npm run rooms` asserts
   * the geometry and texture counters return to baseline rather than trusting
   * this list to be complete. It has already caught one omission: the sky hangs
   * off `scene` rather than `worldGroup`, so the traverse below never reached
   * it and every room leaked exactly one geometry.
   */
  dispose(): void {
    this.props.dispose();
    this.collectibles.dispose();
    this.stage.dispose();
    this.door.dispose();
    this.player.dispose();
    this.motes.dispose();
    this.shockwave.dispose();

    // Anything still parented under the world, chiefly the ground.
    this.worldGroup.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.worldGroup.removeFromParent();

    // The sky is a child of `scene`, not `worldGroup`.
    this.sky.geometry.dispose();
    (this.sky.material as ShaderMaterial).dispose();
    this.sky.removeFromParent();

    this.explored.dispose();
    this.groundMat.dispose();
    this.toyMat.dispose();
    this.playerMat.dispose();
    this.doorMat.dispose();
    this.silhouetteMat.dispose();
    this.instMat.dispose();
    this.paintTex.dispose();
    this.fieldTex.dispose();
    this.noiseTex.dispose();
  }
}
