# Edventure

A 3D painting adventure for a five-year-old who can't read yet.

Every place is a **diorama**: a bounded stage, walled on three sides and open toward you,
like a shoebox or a doll's house cutaway. It starts drained and gray. You roll around, and
everything you touch blooms into colour. Paint enough of it and the door opens.

The open front falls out of the camera's fixed yaw — "toward the viewer" is a constant
world direction, so there is simply no near wall to build. Nothing can ever come between
the camera and the player, with no wall fading and no camera collision.

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
| `npm run rooms <url>` | walks a parade through ten doors and asserts nothing leaks |

Append `?debug=1` to any URL for the stats overlay and a live blit of the paint mask. It
also exposes `__burst()`, `__openDoor()`, `__friend()`, `__parade()`, `__exit()` and
`__mem()` on `window`, which is how the checks above photograph moments that are over in
200 ms instead of trying to catch one by luck.

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

### Scenes

A scene is data (`src/content/scenes/`). `world/Layout.ts` solves declarative placement
rules — `backWall`, `corner`, `ring`, `flankDoor`, `scatter` — into concrete positions from
a seed. That rule vocabulary is what makes a room read as *composed* rather than sprinkled;
a 5-year-old reads a place from a few big recognizable objects, not from hundreds of small
ones. If a scene stops reading as a place, the fix is bigger and fewer fixtures, never more
scatter.

Three things the layout solver guarantees, all tested: no two footprints overlap, the apron
in front of the door stays clear, and the spawn point is always open floor so he never
arrives embedded in a gumdrop. Since big fixtures became solid these are load-bearing for
movement, not just for looks — see **Solid objects** below.

Fixtures and scatter both render as `InstancedMesh` per kind (a unique centrepiece is just
`count = 1`), so draw calls scale with the number of *kinds*, not objects. Paint state is
per-instance and animated in the vertex shader: painting an object writes four floats and
does no CPU matrix work.

### Fog and light

The world is hazy beyond a small circle around the **child** — not the camera, so three.js's
built-in fog is gone entirely and `paint/fog.glsl.ts` supplies a shared radial chunk to every
material instead.

**Painting clears fog permanently.** Props and walls sample the paint mask at their own world
position, so anything standing on painted floor stays lit. Coverage therefore stops being an
abstract number and becomes "I lit up this world". The fog is the sky's colour, never dark —
a small child alone in a dark fog bank is frightening rather than mysterious. The player
never fades at all, and the door is capped at 70% fog so it always glows through as a
landmark.

### Rooms and the door

`progress = 0.6 · groundCoverage + 0.4 · propsPainted`, gated at **0.50** — deliberately low,
because more rooms beats longer rooms at five and each new room is another set of hidden
things. It opens once and never re-locks.

Two things about the door are load-bearing rather than decorative:

- **The moment fires where he is looking, not only at the door.** With tight fog and a low
  camera the door is usually off-screen when it opens, so the celebration also bursts around
  the player and throws a ribbon of sparks spanning the *whole* distance to the doorway. A
  trail that only reaches a few metres from the door is invisible from across a foggy room —
  that makes it decoration, not direction.
- **The back wall is split around the doorway**, so it reads as a real opening rather than an
  ornament stuck to a wall.

Transitions fade via a DOM overlay (no fill cost, cannot fail on a weak GPU) and everything
expensive — teardown, rebuild, `renderer.compile()` — happens behind it. The audio engine
lives at app level, not in the scene, so the ambient pad survives a room change and the
first-touch unlock never re-runs.

**`npm run rooms` is not optional.** `PlayScene.dispose()` was dead code until rooms could be
left, and the very first run of that check found a leak: the sky hangs off `scene` rather
than `worldGroup`, so the teardown traverse never reached it and every room leaked exactly
one geometry. Ten transitions must return the geometry and texture counters to baseline.

It hands him a parade *before* taking the baseline, deliberately. Followers are per-scene
bodies built from an app-level list — the same shape as the bug above — and with an empty
roster none of that code runs and the check passes while proving nothing.

### The parade, and the celebration

Everyone he finds walks along behind him, in every room, for the rest of the session. The
line over his shoulder getting longer **is** the progress bar — there is no other one, and
there are no words in this one.

That only works because of where the pieces live. `game/Roster.ts` is app-level, beside the
audio engine: a scene is thrown away every time he walks through a door, so a scene-owned
list of friends would reset every couple of minutes. `world/Followers.ts` is per-scene and
rebuilds the bodies from that list on arrival. Finding a friend adds it to the parade *that
second*, not in the next room.

They follow a **breadcrumb trail** — a ring buffer of where he has recently been, each
friend sampling it further back. The path already went around whatever he went around, so
nobody pathfinds and nobody walks through a gumdrop hill. Side offsets are taken along the
*normal to the trail*, not along a fixed axis; offsetting along X quietly collapses the line
into a pile the moment he happens to walk east, which is exactly what it did until a test
measured the spacing.

`fx/Celebration.ts` is the cheer → run → wait state machine, and it is deliberately pure
logic with no three.js in it, because the rule that it can never strand him is a rule about
this state machine alone. Every path reaches `wait`, including the two that matter: nobody
found yet, and somebody wedged behind a fixture who never arrives.

The best part of the cheer is nearly free. Props already animate from an `aPaintTime`
attribute in the vertex shader, so `Props.cheer(x, z)` rewrites that value with a delay
proportional to distance — an entire room of candy bouncing outward from him, for one float
per object and no CPU matrix work. A time in the *future* means "already in colour, waiting
to pop"; without that one ternary in the shader the room drains to gray ahead of the wave.
It also means the moment lands at full strength when he has found nothing at all, which is
the likely case the first time he ever finishes a room.

Once the crowd is gathered at the doorway, **they** are the signpost and the ribbon of
sparks stands down. Until then — including if somebody is still stuck — the ribbon keeps
pointing the way.

### The grown-up panel

Hold a screen corner for two seconds. Three icons: record, play, delete. No letters, so
rule #1 holds absolutely rather than by exception.

Behind it is a cheer recorded in your own voice, played when a room is finished. **It never
leaves the phone** — `MediaRecorder` into an IndexedDB blob, read back and played through
the local audio graph. There is no upload and no server in this feature at all, which is the
only acceptable shape for a recording of a family inside a child's app.

The fallback is not a lesser version, and nothing about finishing a room may depend on the
recording existing. No recording, a refused microphone, a container the browser will not
decode: every one of those returns false and the animals cheer instead, each chirping its
own note, all of them degrees of the scene's pentatonic scale so a dozen at once is a chord.
The microphone is never prompted during play — it can only ever be reached by an adult who
went looking for it.

### Hidden objects

Two ways of hiding, mixed deliberately. `disguise` collectibles have no body at all until he
bumps the ordinary prop standing in for them, which rewards touching everything. `tucked`
ones are real objects placed by a scoring pass that seeks spots the terrain or a big fixture
conceals — only possible because the camera is shallow enough for hills to occlude.

The safety net is the **warmth field**: each hiding place bakes a radial gradient into the
field texture's G channel, which the ground shader already sampled and which was previously
unused. Near a hidden thing the floor runs hotter and sparkles. Hot-and-cold is the oldest
wordless mechanic there is, and it is what stops a hidden object becoming a dead end.

### Particles

`fx/Motes.ts` is one pooled `Points` object — a single draw call for every particle.

The point-size formula is load-bearing and easy to get wrong: a world-space radius `r` at
distance `d` covers `r · H / (2 · d · tan(fovY/2))` pixels. An earlier version used
`H * 0.35`, about a third of the correct scale, and every burst rendered as invisible 2-pixel
specks for a whole release. `npm run smoke` now fires a burst deliberately via a debug hook
and photographs it mid-flight, because the old screenshots were all taken after the
particles had decayed.

### Solid objects

`Fixture.solid` is a collision radius, deliberately separate from `footprint` (which is only
layout spacing). Absent or 0 means he rolls straight through, so sprinkles stay frictionless
while gumdrop hills deflect him. A bridge reserves a large footprint and blocks nothing, so
he rolls underneath — the player has no vertical velocity and is always on the ground, which
makes "go under" free.

Pushout runs in `stepMotion` between the XZ integrate and the boundary check. It can't trap
him: footprints never overlap and circles are convex.

Because solids can enclose floor, `world/Reachability.ts` flood-fills from spawn and marks
anything unreachable as unpaintable, so the door's threshold stays achievable. Set the solid
radius to the geometry that actually meets the floor, not the object's overall size — a
lollipop is a thin stick you should be able to walk right up to.

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
| S1 diorama stage: walls, tray, door, placed candy fixtures, paint-on-touch | done |
| T1 player-centred fog; painting clears it permanently | done |
| T2 bursts, sparkles, twinkles | done |
| T3 silly-but-in-tune procedural audio | done |
| T4 terrain hills, solid collision, arch and bridge | done |
| U1 fireworks (point-size bug fixed) | done |
| U2 low camera, tall hills, 48m stage, gradient sky | done |
| U3 tight fog that stays cleared where he has *been* | done |
| U4 hidden objects: disguised + tucked, warmth guidance | done |
| S3 door opens at 50% → walk through → a fresh room | done |
| U5 parade of found friends, following him through every door | done |
| U6 the celebration: room-wide cheer wave, run for the door, your recorded voice | done |
| U7 silhouette pips for the collection | next |
| S4 the candy dinosaur | |
| S5 forest clearing (proves the grammar generalizes) | |
| S6 indoor rooms, tiny worlds, vehicles | |

S3 is the ship point: painting a room, a door that opens, and a new room behind it is a
complete loop. Collectibles, the gallery and the other kits come after.

## Tuning dials

These three are meant to be turned after watching him play, not reasoned about:

- `stage.width` in the scene file — how much room there is to cover.
- `trail.radiusM` in the character file — how fast painting goes.
- `GATE_THRESHOLD` — how much counts as done (0.70, and it must never be 1.0).
