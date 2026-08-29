# Edventure

A 3D painting adventure for a five-year-old who can't read yet.

The world starts drained and gray. You roll around, and everything you touch blooms into
color. Paint enough of an area and the way to the next one opens.

## The three rules

Every decision in this codebase follows from these. If a change breaks one, it's the wrong
change.

1. **Zero text.** No words, no numbers, no letters, anywhere in the game. Not in menus, not
   in progress displays. Progress is shown by the painting itself. The only exception is
   the debug overlay, which is behind `?debug=1`.
2. **One thumb.** One floating joystick, no buttons, and the camera never yaws — so "up"
   is always the same direction in the world.
3. **No way to lose.** No death, no timers, no enemies, no dead ends, no lost progress.

## Running it

```bash
npm install
npm run dev          # then open the Network URL on the phone
```

`npm run dev` binds to the LAN, so the address it prints under **Network** works from a
phone on the same wifi. That's the intended way to test — see *Testing on the real device*
below.

| Command | |
|---|---|
| `npm run dev` | dev server, LAN-accessible |
| `npm run build` | production bundle into `dist/` |
| `npm run preview` | serve the built bundle (needed for service-worker testing) |
| `npm test` | unit tests |
| `npm run typecheck` | `tsc --noEmit` |
| `node scripts/make-icons.mjs` | regenerate the PWA icons |
| `node scripts/smoke.mjs <url>` | headless render + paint check, writes `scratch/shots/` |

Append `?debug=1` to any URL for the stats overlay and a live blit of the paint mask.

## Testing on the real device

The performance floor is a **mid-range Android**, and it is the only measurement that
counts. Everything runs at 300 fps on a laptop.

1. `npm run dev`, open the Network URL on the phone.
2. Chrome → menu → **Add to Home Screen**. Launch it from the icon, not the browser tab —
   standalone mode is the real delivery mode and behaves differently (no URL bar, the back
   gesture exits the app).
3. Plug the phone in and open `chrome://inspect` on the desktop to profile it live.

Install via Chrome specifically: Samsung Internet 27+ no longer fires
`beforeinstallprompt` and creates a plain shortcut rather than a true standalone app.

## Architecture

```
src/
├── core/     engine primitives, zero game knowledge
├── shape/    ShapeBuilder — THE asset pipeline, all ~200 lines of it
├── paint/    the paint mask, its shader, and coverage
├── world/    terrain and (later) area generation
├── player/   character assembly, movement flavors, camera
├── game/     scenes and progression
├── ui/       joystick, debug overlay
└── content/  PURE DATA — biomes, characters, collectibles
```

**The one architectural rule: `content/` imports nothing.** No `three`, no engine modules.
It exports plain objects and hex numbers, and `shape/ShapeBuilder.ts` is the only thing
that turns them into geometry. That rule is what makes "adding content = adding a data
file" true rather than aspirational — there are no models, no rigs, no textures and no
Blender step anywhere in this project.

### The paint system

`src/paint/PaintMask.ts` is the heart of the game. A CPU-side `Uint8Array` (R = paint
amount, G = freshness) uploaded as an RG8 `DataTexture`; the ground shader lerps between a
drained gray and the biome's colors per fragment.

Paint is **max-blend and monotonic**. That single choice means the coverage counter only
ever increments (so it's maintained incrementally, never rescanned), the save file is a
pure union with no ordering bugs, and reloading a saved area can't produce a different
number than when you left it.

Two things here are easy to break:

- **`AreaTransform` is the single source of truth** for world ↔ cell ↔ uv. The mapping
  must never be written twice — once in JS and once in GLSL is the classic way to get a
  paint trail that sits half a metre behind the ball. There's a test pinning the JS and
  shader mappings together.
- **Texture upload parameters are set once at creation and never mutated.** Mutating
  `format`, `flipY`, `unpackAlignment` or `generateMipmaps` afterwards makes three
  reallocate the whole texture every frame instead of doing a `texSubImage2D`.

### Performance

Budget against a mid-range Android at **8 ms cold**, not 16 — these devices lose 30–50% to
thermal throttling after 10–20 minutes, and a 16 ms cold frame becomes a visibly stuttery
24 ms warm one.

The biggest single lever is the pixel-ratio cap in `core/Quality.ts`: a 1080×2400 phone at
DPR 3 is a 2.59 MP drawing buffer, capped at 1.75 it's 1.15 MP — a 2.25× cut in fragment
work. The adaptive governor watches a 90-frame *median* (so one GC pause doesn't demote the
device) and steps tiers with hysteresis, which also handles thermal throttling for free.

Things that will tank the framerate, roughly in order: `setPixelRatio(devicePixelRatio)`,
any post-processing pass, shadow maps, per-frame allocations, and shader compile hitches.
Notably **not** the mask upload — that's under 1% of the frame.

## Status

| Milestone | |
|---|---|
| M0 PWA shell, fixed-step loop, context-loss recovery, quality tiers | done |
| M1 terrain, character, joystick, camera | done |
| M2 paint mask, ground shader, coverage | done |
| M3 instanced props | next |
| M4 procedural audio | |
| M5 hidden collectibles | |
| M6 gate + completion → **shippable** | |

M6 is the ship point: painting, collecting, a gate, and endless areas is a complete game.
The gallery, characters and extra biomes come after, with a player who's already invested.

## Tuning dials

These three are meant to be turned after watching him play, not reasoned about:

- `worldSize` in the biome file — how much area there is to cover.
- `trail.radiusM` in the character file — how fast painting goes.
- `GATE_THRESHOLD` — how much counts as done (0.70, and it must never be 1.0).
