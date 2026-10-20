import express from 'express';
import { createServer } from 'http';
import { networkInterfaces } from 'os';
import path from 'path';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { PORT, ROOM_NAME } from 'shared/constants';
import { RaceRoom } from './RaceRoom';

const port = Number(process.env.PORT) || PORT;
const app = express();
const server = createServer(app);

// LAN addresses a host can share with friends (the server binds 0.0.0.0).
// In Docker the interfaces are the container's, so the image sets ADVERTISE_LAN=0; PUBLIC_ADDRESS overrides both.
app.get('/api/server-info', (_req, res) => {
  if (process.env.PUBLIC_ADDRESS) { res.json({ addresses: [process.env.PUBLIC_ADDRESS] }); return; }
  if (process.env.ADVERTISE_LAN === '0') { res.json({ addresses: [] }); return; }
  const addresses = Object.values(networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => `${i!.address}:${port}`);
  res.json({ addresses });
});

// Built client sits next to the bundle in production (client/dist); the desktop app passes CLIENT_DIR.
app.use(express.static(process.env.CLIENT_DIR || path.resolve(__dirname, '../../client/dist')));

const gameServer = new Server({ transport: new WebSocketTransport({ server }) });
gameServer.define(ROOM_NAME, RaceRoom);

gameServer.listen(port, '0.0.0.0').then(() => console.log(`Rune Kart server on 0.0.0.0:${port}`));
