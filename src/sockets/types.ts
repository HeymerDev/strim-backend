import type { Server, Socket } from 'socket.io';
import type { ChannelStatus, ChatMessageDTO, PublicChannelDTO } from '../models';
import type { ErrorCode } from '../utils/AppError';

// Respuesta (ack) de cada evento del cliente (diseño §7).
export type AckResponse<T> = ({ ok: true } & T) | { ok: false; error: { code: ErrorCode; message: string } };
export type Ack<T> = (response: AckResponse<T>) => void;

// Lo que manda el cliente es dato no confiable: los payloads se validan con zod en el controlador.
export interface ClientToServerEvents {
  'chat:join': (payload: unknown, ack?: Ack<{ channel: PublicChannelDTO; messages: ChatMessageDTO[] }>) => void;
  'chat:leave': (ack?: Ack<object>) => void;
  'chat:send': (payload: unknown, ack?: Ack<{ message: ChatMessageDTO }>) => void;
}

export interface ServerToClientEvents {
  'chat:message': (message: ChatMessageDTO) => void;
  'stream:status': (payload: { isLive: boolean; liveStartedAt: string | null; playbackUrl: string | null }) => void;
  'stream:title': (payload: { title: string }) => void;
  'stream:state': (payload: { status: ChannelStatus; title: string; liveStartedAt: string | null }) => void;
  'viewers:count': (payload: { viewers: number }) => void;
  'channel:deleted': (payload: Record<string, never>) => void;
}

export interface SocketData {
  // null = anónimo, solo lectura.
  userId: string | null;
  // Vencimiento del access token (segundos Unix), para rechazar mensajes con token vencido.
  exp: number | null;
  // Canal cuya sala ocupa el socket (una a la vez).
  channelId: string | null;
}

export type StrimServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type StrimSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
