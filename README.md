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

## Play it

**https://maridizzle.github.io/edventure/**

On the phone, open that in **Chrome** → menu → **Add to Home Screen**, then launch it from
the icon rather than the browser tab. Standalone is the real delivery mode: no URL bar, it
works with the wifi off, and it behaves differently enough that it's the only way worth
testing (the Android back gesture exits the app from the root, for one).

Install from Chrome specifically — Samsung Internet 27+ no longer fires
`beforeinstallprompt` and gives you a plain shortcut instead of a true standalone app.

Every push to the default branch redeploys automatically, gated on typecheck and tests, so
a broken build can't reach his phone.

## Developing

```bash
npm install
npm run dev          # LAN-accessible; open the Network URL on a phone
```

| Command | |
|---|---|
| `npm run dev` | dev server, LAN-accessible |
| `npm run build` | production bundle into `dist/` |
| `npm run preview` | serve the built bundle (needed for service-worker testing) |
| `npm test` | unit tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run icons` | regenerate the PWA icons |
| `npm run build:standalone` | one self-contained HTML file — the tap-to-play link |
| `npm run smoke <url\|file>` | headless render + paint check, writes `scratch/shots/` |
| `npm run offline <url>` | proves the service worker serves the app with the network cut |

Append `?debug=1` to any URL for the stats overlay and a live blit of the paint mask.

`BASE_PATH` controls where the app expects to be served from; CI sets `/edventure/` for the
Pages project site. Getting this wrong doesn't break the first load — it breaks the
*second* one, once the service worker is serving, as a white screen. `npm run offline` is
the check that catches it:

```bash
BASE_PATH=/edventure/ npm run build
BASE_PATH=/edventure/ npm run preview -- --port 4174
npm run offline http://127.0.0.1:4174/edventure
```

## Testing on the real device

The performance floor is a **mid-range Android**, and it is the only measurement that
counts. Everything runs at 300 fps on a laptop, and the headless smoke test runs on
software rendering — neither tells you anything about frame time.

Plug the phone in and open `chrome://inspect` on a desktop to profile the real thing.

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
