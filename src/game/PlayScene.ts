import {
  Color,
  Fog,
  Mesh,
  Scene,
  SRGBColorSpace,
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
import { Character } from '../player/Character';
import { FollowCamera } from '../player/FollowCamera';
import { FLAVORS, makeMoveState, stepMotion, type MoveState } from '../player/Motion';
import { createToyMaterial } from '../shape/ToyMaterial';
import { blob } from '../content/characters/blob';
import { meadow } from '../content/biomes/meadow';
import type { BiomeDef } from '../content/types';

const NOISE_SIZE = 128;

export class PlayScene {
  readonly scene = new Scene();
  readonly follow: FollowCamera;

  readonly biome: BiomeDef;
  readonly terrain: Terrain;
  readonly transform: AreaTransform;
  readonly mask: PaintMask;

  private groundMat: ShaderMaterial;
  private toyMat: ShaderMaterial;
  private paintTex;
  private fieldTex;
  private noiseTex;

  private player: Character;
  private move: MoveState;
  private prevCellX = 0;
  private prevCellZ = 0;

  private time = 0;
  private frameIndex = 0;
  private settings: TierSettings;

  constructor(seed: number, settings: TierSettings, aspect: number, biome: BiomeDef = meadow) {
    this.biome = biome;
    this.settings = settings;

    const t = biome.terrain;
    this.terrain = new Terrain(
      {
        worldSize: t.worldSize,
        grid: settings.terrainGrid,
        octaves: t.octaves,
        warpFreq: t.warp.freq,
        warpAmp: t.warp.amp,
        maxSlopeDeg: t.maxSlopeDeg,
        edgeFalloffStart: t.edgeFalloff.start,
        edgeFalloffPower: t.edgeFalloff.power,
      },
      seed,
    );

    this.transform = AreaTransform.centered(t.worldSize, settings.maskCells);
    this.mask = new PaintMask(settings.maskCells);
    // M2: everything is paintable. The reachability flood-fill lands with the
    // area generator in M7 and will replace this.
    this.mask.setAllPaintable();

    // --- textures ---
    this.paintTex = createPaintTexture(this.mask);
    const field = new Uint8Array(settings.maskCells * settings.maskCells * 2);
    for (let i = 0; i < settings.maskCells * settings.maskCells; i++) field[i * 2] = 255;
    this.fieldTex = createFieldTexture(field, settings.maskCells);
    this.noiseTex = createNoiseTexture(
      makeNoiseTextureData(NOISE_SIZE, stream(seed, 'noisetex')),
      NOISE_SIZE,
    );

    // --- sky + fog ---
    this.scene.background = new Color().setHex(biome.sky.horizon, SRGBColorSpace);
    this.scene.fog = new Fog(
      new Color().setHex(biome.sky.fogColor, SRGBColorSpace).getHex(),
      biome.sky.fogNear,
      Math.min(biome.sky.fogFar, settings.fogFar),
    );

    const lightDir = new Vector3(...biome.light.dir).normalize();

    // --- ground ---
    this.groundMat = createGroundMaterial({
      palette: biome.palette,
      transform: this.transform,
      paintTex: this.paintTex,
      fieldTex: this.fieldTex,
      noiseTex: this.noiseTex,
      heightMin: this.terrain.minHeight,
      heightRange: this.terrain.maxHeight - this.terrain.minHeight,
      lightDir,
      fogColor: biome.sky.fogColor,
      fogNear: biome.sky.fogNear,
      fogFar: Math.min(biome.sky.fogFar, settings.fogFar),
    });
    const ground = new Mesh(this.terrain.buildGeometry(), this.groundMat);
    ground.frustumCulled = false;
    this.scene.add(ground);

    // --- player ---
    this.toyMat = createToyMaterial({
      lightDir,
      grayTint: biome.palette.grayTint,
      fogColor: biome.sky.fogColor,
      fogNear: biome.sky.fogNear,
      fogFar: Math.min(biome.sky.fogFar, settings.fogFar),
      painted: true,
    });
    this.player = new Character(blob, this.toyMat, settings.shapeDetail);
    this.scene.add(this.player.group);

    this.move = makeMoveState(blob.radius);
    this.move.pos.set(0, 0, 0);
    this.move.pos.y = this.terrain.heightAt(0, 0) + blob.radius;
    this.prevCellX = this.transform.cellX(this.move.pos.x);
    this.prevCellZ = this.transform.cellZ(this.move.pos.z);

    this.follow = new FollowCamera(aspect);
    this.follow.reset(this.move.pos);
  }

  get coverage(): number {
    return this.mask.coverage;
  }

  /** Fixed 60 Hz. */
  fixedUpdate(input: Vector2, dt: number): void {
    stepMotion(
      this.move,
      blob.movement,
      input,
      this.terrain,
      this.biome.terrain.worldSize,
      dt,
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

    this.player.update(this.move, dt);
  }

  /** Once per rendered frame — never from the sim step. */
  render(renderer: WebGLRenderer, dt: number): void {
    this.time += dt;
    this.frameIndex++;

    this.mask.decayPulse();

    // The upload. Full re-upload when dirty, at most once per frame, throttled
    // by tier. At interval 3 the trail lags 50ms behind the ball, which is
    // invisible because the bloom is animated in the shader anyway.
    if (this.mask.dirty && this.frameIndex % this.settings.maskUploadInterval === 0) {
      this.paintTex.needsUpdate = true;
      this.mask.dirty = false;
    }

    this.groundMat.uniforms.uTime!.value = this.time;

    this.follow.update(
      dt,
      this.move.pos,
      this.move.vel,
      this.move.speedNorm,
      blob.face.lookAhead,
    );

    renderer.render(this.scene, this.follow.camera);
  }

  applySettings(s: TierSettings): void {
    // Only live-adjustable knobs. Mask resolution and terrain grid need a
    // rebuild, so the governor must never touch them mid-play.
    this.settings.maskUploadInterval = s.maskUploadInterval;
    this.settings.particles = s.particles;
  }

  resize(w: number, h: number): void {
    this.follow.setAspect(w, h);
  }

  dispose(): void {
    this.scene.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.player.dispose();
    this.groundMat.dispose();
    this.toyMat.dispose();
    this.paintTex.dispose();
    this.fieldTex.dispose();
    this.noiseTex.dispose();
  }
}
