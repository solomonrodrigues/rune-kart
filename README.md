# Rune Kart

Low-poly multiplayer kart racer with mana-powered spells. See [PLAN.md](PLAN.md).

```bash
docker compose up -d --build   # server + built client on http://localhost:2567 (WEB_PORT=… to change)
npm install && npm run dev     # hot-reload dev: Vite on :5173, server on :2567 (stop the container first)
npm test                       # shared sim tests
```

Open `/?offline` to drive solo with the sim running locally (no network). In offline mode the console exposes `KART` (live tuning, e.g. `KART.maxSpeed = 35`) and `me` (your kart state).

Online, your kart is predicted locally and reconciled against the server; other karts are drawn 100 ms in the past between server snapshots. Add `?lag=150` to simulate a 150 ms round trip on localhost.

Controls: WASD / arrows to drive, Space or Shift to drift (hold while steering, release for a boost; sparks go blue → orange → purple).
