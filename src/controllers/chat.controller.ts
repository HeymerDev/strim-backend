import { ForeignKeyConstraintError } from 'sequelize';
import { Channel, ChatMessage, type ChatMessageDTO, Profile, type PublicChannelDTO } from '../models';
import { channelRoom, emitToChannel, getViewers, markViewersChanged } from '../sockets/emit';
import type { StrimSocket } from '../sockets/types';
import { AppError } from '../utils/AppError';
import { joinPayload, sendPayload } from '../validators/chat';

const HISTORY_SIZE = 50;
const MIN_INTERVAL_MS = 1_000;

// Último mensaje de cada usuario, para el límite de 1 por segundo (RF-15.4).
const lastMessageAt = new Map<string, number>();

function pruneRateLimits(now: number) {
  if (lastMessageAt.size < 1_000) return;
  for (const [userId, at] of lastMessageAt) if (now - at > MIN_INTERVAL_MS) lastMessageAt.delete(userId);
}

async function loadHistory(channelId: string): Promise<ChatMessageDTO[]> {
  const rows = await ChatMessage.findAll({
    where: { channelId },
    include: [{ model: Profile, as: 'author' }],
    order: [['id', 'DESC']],
    limit: HISTORY_SIZE,
  });
  return rows.reverse().map((row) => row.toMessage());
}

// Sale de la sala actual, si está en una.
function leaveCurrent(socket: StrimSocket) {
  const current = socket.data.channelId;
  if (!current) return;
  socket.leave(channelRoom(current));
  socket.data.channelId = null;
  markViewersChanged(current);
}

// RF-14.1 a RF-14.3, RF-14.6: cualquiera (con o sin sesión) puede unirse, esté o no en vivo.
export async function joinChannel(
  socket: StrimSocket,
  payload: unknown,
): Promise<{ channel: PublicChannelDTO; messages: ChatMessageDTO[] }> {
  const { username } = joinPayload.parse(payload);
  const profile = await Profile.findOne({ where: { username }, include: [Channel] });
  if (!profile?.channel) throw new AppError('NOT_FOUND');

  // Una sala a la vez.
  if (socket.data.channelId !== profile.id) leaveCurrent(socket);
  socket.data.channelId = profile.id;
  await socket.join(channelRoom(profile.id));
  markViewersChanged(profile.id);

  return { channel: profile.toPublic(getViewers(profile.id)), messages: await loadHistory(profile.id) };
}

// RF-14.3
export function leaveChannel(socket: StrimSocket) {
  leaveCurrent(socket);
  return {};
}

// RF-15
export async function sendMessage(socket: StrimSocket, payload: unknown): Promise<{ message: ChatMessageDTO }> {
  const { userId, exp, channelId } = socket.data;
  if (!userId) throw new AppError('AUTH_REQUIRED');
  if (!exp || exp * 1000 <= Date.now()) throw new AppError('UNAUTHORIZED');
  if (!channelId) throw new AppError('NOT_IN_ROOM');

  const now = Date.now();
  if (now - (lastMessageAt.get(userId) ?? 0) < MIN_INTERVAL_MS) throw new AppError('RATE_LIMITED');

  const { content } = sendPayload.parse(payload);
  lastMessageAt.set(userId, now);
  pruneRateLimits(now);

  let created: ChatMessage;
  try {
    created = await ChatMessage.create({ channelId, userId, content });
  } catch (err) {
    // El canal se borró justo mientras se enviaba el mensaje (RF-08).
    if (err instanceof ForeignKeyConstraintError) {
      socket.data.channelId = null;
      throw new AppError('NOT_IN_ROOM');
    }
    throw err;
  }
  const saved = await ChatMessage.findByPk(created.id, { include: [{ model: Profile, as: 'author' }] });
  const message = saved!.toMessage();

  // Le llega a toda la sala, incluido el autor (RF-15.1).
  emitToChannel(channelId, 'chat:message', message);
  return { message };
}
