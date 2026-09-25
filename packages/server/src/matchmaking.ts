import type { Socket } from 'socket.io';

export interface QueueEntry {
  socket: Socket;
  nickname: string;
}

const queue: QueueEntry[] = [];

/**
 * Pushes the socket onto the FIFO queue; returns a pair the instant two players are waiting.
 * A socket already in the queue is not added twice (double-clicked "start").
 */
export function enqueue(socket: Socket, nickname: string): [QueueEntry, QueueEntry] | null {
  if (isQueued(socket)) return null;
  queue.push({ socket, nickname });
  if (queue.length >= 2) {
    const a = queue.shift()!;
    const b = queue.shift()!;
    return [a, b];
  }
  return null;
}

export function dequeue(socket: Socket): void {
  const idx = queue.findIndex((entry) => entry.socket.id === socket.id);
  if (idx !== -1) queue.splice(idx, 1);
}

export function isQueued(socket: Socket): boolean {
  return queue.some((entry) => entry.socket.id === socket.id);
}
