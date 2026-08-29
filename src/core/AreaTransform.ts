import { Vector2 } from 'three';

/**
 * The single source of truth for world <-> mask-cell <-> uv.
 *
 * Risk #7: writing this mapping twice — once in JS for stamping, once in GLSL
 * for sampling — is the #1 cause of "the paint trail is offset from the ball",
 * and it is maddening to debug because it spans two languages. So only two
 * values ever reach the shader (`uMaskOrigin`, `uMaskInvSize`), and the JS side
 * derives everything from the same three numbers.
 */
export class AreaTransform {
  readonly cellsPerMetre: number;
  readonly metresPerCell: number;

  constructor(
    readonly originX: number,
    readonly originZ: number,
    readonly worldSize: number,
    readonly cells: number,
  ) {
    this.cellsPerMetre = cells / worldSize;
    this.metresPerCell = worldSize / cells;
  }

  /** Centred square area of `worldSize` metres. */
  static centered(worldSize: number, cells: number): AreaTransform {
    return new AreaTransform(-worldSize / 2, -worldSize / 2, worldSize, cells);
  }

  cellX(wx: number): number {
    return (wx - this.originX) * this.cellsPerMetre;
  }

  cellZ(wz: number): number {
    return (wz - this.originZ) * this.cellsPerMetre;
  }

  worldX(cx: number): number {
    return this.originX + cx * this.metresPerCell;
  }

  worldZ(cz: number): number {
    return this.originZ + cz * this.metresPerCell;
  }

  index(cx: number, cz: number): number {
    return cz * this.cells + cx;
  }

  /** Metres -> cells, for brush radii. */
  radiusCells(metres: number): number {
    return metres * this.cellsPerMetre;
  }

  uniforms(): { uMaskOrigin: Vector2; uMaskInvSize: number } {
    return {
      uMaskOrigin: new Vector2(this.originX, this.originZ),
      uMaskInvSize: 1 / this.worldSize,
    };
  }
}
