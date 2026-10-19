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

// Conexiones en la sala de un canal, con o sin sesión (RF-16.1).
export function getViewers(channelId: string): number {
  return io?.sockets.adapter.rooms.get(channelRoom(channelId))?.size ?? 0;
}

// Salas cuyo número de espectadores cambió desde el último aviso.
const changedChannels = new Set<string>();

export function markViewersChanged(channelId: string) {
  changedChannels.add(channelId);
}

// Avisa el número de espectadores solo a las salas que cambiaron (RF-16.2). Corre cada 5 s.
export function flushViewerCounts() {
  for (const channelId of changedChannels) {
    emitToChannel(channelId, 'viewers:count', { viewers: getViewers(channelId) });
  }
  changedChannels.clear();
}

// Cierra todas las conexiones de un usuario (RF-08.5).
export function disconnectUser(userId: string) {
  io?.in(userRoom(userId)).disconnectSockets(true);
}
