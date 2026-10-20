# Rune Kart

Low-poly multiplayer kart racer with mana-powered spells. See [PLAN.md](PLAN.md).

```bash
docker compose up -d --build   # server + built client on http://localhost:2567 (WEB_PORT=… to change)
npm install && npm run dev     # hot-reload dev: Vite on :5173, server on :2567 (stop the container first)
npm test                       # shared sim tests
```

LAN play from Docker: friends open `http://<your-ip>:2567` in a browser. Start with `PUBLIC_ADDRESS=<your-ip>:2567 docker compose up -d` to show that address in the lobby.

Desktop app (optional, for hosting without Docker): `npm run desktop` runs it; `npm run desktop:mac` / `desktop:win` build a DMG / portable .exe into `release/` (first `npm install --prefix electron`). It hosts the same server and shows your LAN address in the lobby; friends can join from the app or any browser.

Open the game at `/` for the main menu: **Quick Race** (join an open lobby or start one), **Host Lobby** (pick a track — Moonlit Loop, Hollow Crown or Serpent's Pass — laps, public/private), **Join Lobby** (browse open lobbies or enter a room code), **Practice** and **How to Play**. Your name is remembered. In a lobby the host adds bots (B / N) and sets laps ([ / ]); the address bar holds a link to the room you can share; Esc leaves to the menu. Game URLs work directly too: `/?quick`, `/?host&track=hollow&laps=3`, `/?join=<code>`, `/?practice&track=serpent`. New tracks go in `shared/src/tracks.ts` and are tested automatically.

Open `/?offline` (or `/?practice`) to drive solo with the sim running locally (no network). In offline mode the console exposes `KART` and `MANA` (live tuning, e.g. `KART.maxSpeed = 35`, `MANA.smite.turnRate = 3`) and `me` (your kart state).

Online, your kart is predicted locally and reconciled against the server; other karts are drawn 100 ms in the past between server snapshots. Add `?lag=150` to simulate a 150 ms round trip on localhost.

Racing: press B / N in the lobby to add or remove bots, then everyone presses Enter to ready up, then a 3 s countdown, 3 laps (`LAPS=1 docker compose up -d` for quick test races), results for 10 s, and back to the lobby. Once you finish, your kart drives itself and the camera swings round to the front while the others finish. Add `?autopilot` to have it drive for you the whole race (handy for testing solo).

Spells: your mana orb (bottom left) refills over time, faster while drifting and when you're behind. Keys 1–4 cast **Haste** (boost), **Smite** (forward projectile, spins out the kart it hits), **Snare** (a rune trap dropped behind you) and **Ward** (blocks the next hit). Costs and cooldowns live in `shared/src/spells.ts`.

Controls: Enter to ready up, 1–4 to cast, hold C to look back, WASD / arrows to drive, Space or Shift to drift (hold while steering, release for a boost; sparks go blue → orange → purple).
