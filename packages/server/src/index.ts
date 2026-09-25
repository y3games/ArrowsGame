import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@arrows/shared';
import { SERVER_CONFIG } from './config.js';
import { registerSocketHandlers } from './socketHandlers.js';

// Socket.IO handles everything under /socket.io/ itself; this only answers the host's health probe.
const httpServer = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  res.writeHead(404).end();
});
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: SERVER_CONFIG.CORS_ORIGINS },
});

registerSocketHandlers(io);

httpServer.listen(SERVER_CONFIG.PORT, () => {
  console.log(`[arrows-server] listening on :${SERVER_CONFIG.PORT}`);
});
