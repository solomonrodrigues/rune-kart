# Rune Kart — Foundation Plan

Low-poly multiplayer kart racer with spells instead of item boxes. Each kart has a **mana orb** that refills over time, Diablo-style, and you spend mana to cast spells. The game is playable in a browser against a remote server, or as a desktop app that hosts a LAN game — same model as coot-of-duty.

## Stack (recommended)

Use coot-of-duty's stack. It already works for both hosting modes, and you know where its problems are.

| Layer | Choice | Why |
|---|---|---|
| Rendering | **Three.js** + Vite + TypeScript | Low poly needs no heavier engine. Babylon/PlayCanvas add weight but not features you need. |
| Multiplayer | **Colyseus 0.16** (authoritative server, schema state) | Rooms, matchmaking, delta-patched state, reconnection. Proven in coot. |
| Kart physics | **Hand-rolled arcade model in `shared/`** + **three-mesh-bvh** for track raycasts | Kart feel matters more than realism, and the same deterministic code runs on client (prediction) and server (authority). A general rigid-body engine (Rapier/cannon) fights you on drift and boost tuning. |
| Tracks | **Blender → glTF (.glb)**, with named empties for markers | A track is a sculpted mesh, not a grid of walls, so coot's JSON map format doesn't fit. |
| Desktop / LAN | **Electron**, spawning the game server on `0.0.0.0` | Same as coot. |
| Remote hosting | **Docker** image (Node server that also serves `client/dist`) behind nginx/Cloudflare for `wss://` | Fits a Lightsail box. |

## Repo layout

```
rune-kart/
├── client/     Vite + Three.js: rendering, input, prediction, HUD, lobby
├── server/     Colyseus: RaceRoom, race state, spells, bots
├── shared/     Kart physics, mana/spell rules + spell table, track loader, constants (no DOM, no Node APIs)
├── electron/   main.js: spawns server, opens window, shows LAN address
├── tracks/     *.glb + *.json sidecar (laps, name, thumbnail)
└── Dockerfile  + compose.yml for the remote server
```

npm workspaces, as in coot.

## Changes from coot-of-duty

Coot's Electron packaging needed `server-deps/`, `NODE_PATH` hacks and a postbuild symlink so `shared/` resolves in the asar. **Bundle the server into one file with esbuild** (`server/dist/index.js`, `shared/` inlined, Colyseus left external or bundled too). Electron then runs that single file with `ELECTRON_RUN_AS_NODE=1`, and most of that plumbing goes away.

Carry these over unchanged:
- `/api/server-info`, which lists the LAN IPs to share. The lobby shows "Host" and "Join by IP".
- `/api/rooms` for the join browser.
- The fixed-step sim at 60 Hz, the input sequence numbers and `PredictionRing`.
- Never pass `fullscreen: false` to `BrowserWindow`. On macOS that makes the window non-fullscreenable.

## Netcode model (racing differs from FPS)

- **Own kart:** client-side prediction. Send inputs `{seq, steer, throttle, brake, drift, cast}` at 60 Hz. The server sends authoritative state plus the last input seq it processed; the client rewinds and replays. This is the same loop as coot.
- **Other karts:** interpolate about 100 ms behind using server snapshots. Remote karts move fast, so add short extrapolation when snapshots arrive late.
- **Kart-vs-kart bumps:** resolved only on the server. The client blends its correction over about 150 ms so it doesn't snap. This is the hardest feel problem, so test it early with two clients on a lossy link.
- **Spells:** see the next section.
- **Patch rate:** 60 Hz on LAN, 20–30 Hz remote (env var).

## Mana & spells (the core gimmick)

Mana is part of the kart state, so it lives in the same deterministic sim as the physics:

- `kart.mana` (0–max) and `kart.cooldowns[slot]` belong in `shared/`. `step()` adds `regenRate * dt` each tick. Because the client runs the same step, its mana bar is predicted and never lags.
- **Casting:** the input carries `cast: slotIndex | null`. On the tick the server processes that input, it checks mana ≥ cost and that the cooldown is ready, deducts the cost and spawns the effect. The client predicts the deduction and the cast VFX. If the server rejects the cast (rare, because both sides run the same rules), the reconcile restores the mana and the client cancels the VFX.
- **Spell table:** one data file in `shared/spells.ts` with `{id, cost, cooldown, kind: self | projectile | dropped | aura, params}`. Balancing means editing this file, not code.
- **Effects:** self-buffs (boost, shield) are predicted on the client like drift. Projectiles, traps and auras that touch other karts are simulated only on the server and replicated as schema entities. The client interpolates them like remote karts.
- **Loadout:** pick N spells in the lobby, bound to keys 1–N or face buttons. Start with a fixed loadout, and add the picker once spells feel good.
- **Tuning knobs to plan for:** a regen-rate multiplier by race position (gentle catch-up in place of Mario Kart's item luck), optional mana-orb pickups on the track (`mana_*` empties), and drift-charge mana (drifting refills mana, which rewards skill). Make each one a constant, and decide by playtesting.
- **Server-side checks:** the server never trusts a client's mana value, only its cast requests. This is the anti-cheat boundary.

## Race logic (server-owned)

- Track sidecar or glTF empties give you: `spawn_01..08` (grid), `cp_00..N` (ordered checkpoint planes), `col_*` meshes (collision only, hidden), `offroad_*` (slow zones).
- **Progress** = `lap * N + checkpointIndex + fractionToNext`. Sort by it to get race positions. Checkpoints must be passed in order, which also stops shortcut exploits.
- **States:** `lobby → countdown → racing → finished (results, 10s) → lobby`.
- **Respawn:** after falling off the track or pressing a key, place the kart at the last checkpoint.

## Kart physics sketch (`shared/KartPhysics.ts`)

Pure function `step(kart, input, track, dt) → kart`, deterministic, with no Three.js scene dependency:
1. Raycast down (BVH on the collision mesh) to get ground normal and height. Align the kart to the normal, and apply gravity when airborne.
2. Accelerate and brake along forward. Lateral friction is high when gripping and low when drifting.
3. Drift: hold to slide, build charge, release to boost (tiered).
4. Wall collision: sphere vs BVH, push out and reflect velocity with damping.

A node test runs the same input sequence twice and asserts identical output. That determinism check protects prediction.

## Milestones

1. **Scaffold:** workspaces, Vite client, Colyseus server, esbuild server bundle, Docker compose. Goal: a cube on a plane, joined by two browser tabs.
2. **Feel (offline):** kart physics on one greybox glTF track, chase camera, drift and boost. Most of the tuning time goes here.
3. **Networked driving:** RaceRoom, prediction for your own kart, interpolation for others, server-side bumps.
4. **Race loop:** lobby, track select, countdown, checkpoints and laps, positions HUD, results.
5. **Mana + spells:** mana orb HUD, regen, 3–4 starter spells (for example a self boost, a bolt projectile, a dropped rune trap and a ward that blocks one hit), and loadout choice in the lobby.
6. **Ship:** Electron LAN host builds (mac and win portable, as in coot), and a Docker deploy to a remote box with `wss`.
7. **Later:** bots driving a racing-line spline, more tracks, audio, cosmetics.

## Open decisions

- Max players per race (8 is a sensible default and keeps bandwidth trivial).
- Size of the spell loadout (3 is a sensible starting point), and whether spells are fixed per kart/character or freely picked.
- Whether you want an in-game track editor, as coot has. If so, use spline-based track generation from JSON control points instead of glTF. That costs more upfront but lets anyone make tracks.
