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
app.get('/api/server-info', (_req, res) => {
  const addresses = Object.values(networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => `${i!.address}:${port}`);
  res.json({ addresses });
});

// Built client sits next to the bundle in production (client/dist); CLIENT_DIR overrides for Electron later.
app.use(express.static(process.env.CLIENT_DIR || path.resolve(__dirname, '../../client/dist')));

const gameServer = new Server({ transport: new WebSocketTransport({ server }) });
gameServer.define(ROOM_NAME, RaceRoom);

gameServer.listen(port, '0.0.0.0').then(() => console.log(`Rune Kart server on 0.0.0.0:${port}`));
