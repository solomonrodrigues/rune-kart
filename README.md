# Rune Kart

Low-poly multiplayer kart racer with mana-powered spells. See [PLAN.md](PLAN.md).

```bash
docker compose up -d --build   # server + built client on http://localhost:2567 (WEB_PORT=… to change)
npm install && npm run dev     # hot-reload dev: Vite on :5173, server on :2567 (stop the container first)
npm test                       # shared sim tests
```
