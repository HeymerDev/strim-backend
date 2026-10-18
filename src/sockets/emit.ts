import type { ServerToClientEvents, StrimServer } from './types';

// Avisos a las salas, para usar desde los controladores HTTP y el monitor.
// Si Socket.IO no está iniciado (scripts, pruebas) no hacen nada.

let io: StrimServer | null = null;

export const channelRoom = (channelId: string) => `channel:${channelId}`;
export const userRoom = (userId: string) => `user:${userId}`;

export function setSocketServer(server: StrimServer | null) {
  io = server;
}

export function emitToChannel<E extends keyof ServerToClientEvents>(
  channelId: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
) {
  io?.to(channelRoom(channelId)).emit(event, ...args);
}

export function emitToUser<E extends keyof ServerToClientEvents>(
  userId: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
) {
  io?.to(userRoom(userId)).emit(event, ...args);
}

// Conexiones en la sala de un canal, con o sin sesión (RF-16).
export function getViewers(channelId: string): number {
  return io?.sockets.adapter.rooms.get(channelRoom(channelId))?.size ?? 0;
}

// Cierra todas las conexiones de un usuario (RF-08.5).
export function disconnectUser(userId: string) {
  io?.in(userRoom(userId)).disconnectSockets(true);
}
