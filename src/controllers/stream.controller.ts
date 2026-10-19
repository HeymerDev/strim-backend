import type { RequestHandler } from 'express';
import { kickPublisher } from '../config/mediamtx';
import { authOf } from '../middlewares/requireAuth';
import type { Profile } from '../models';
import { emitToChannel, emitToUser } from '../sockets/emit';
import { AppError } from '../utils/AppError';
import { generateStreamKey } from '../utils/streamKey';
import type { StartStreamBody, UpdateStreamBody } from '../validators/stream';

// Avisa el estado del canal: a la sala del chat (estado público) y al dueño (estado completo).
// También lo usa el monitor de señales.
export function notifyStreamChange(profile: Profile) {
  const { isLive, liveStartedAt, playbackUrl } = profile.toPublic(0);
  emitToChannel(profile.id, 'stream:status', { isLive, liveStartedAt, playbackUrl });
  const { status, title } = profile.toDashboard();
  emitToUser(profile.id, 'stream:state', { status, title, liveStartedAt });
}

function notifyTitle(profile: Profile) {
  emitToChannel(profile.id, 'stream:title', { title: profile.channel?.title ?? '' });
}

// Corta OBS sin hacer fallar la petición si MediaMTX no responde:
// el monitor lo vuelve a intentar mientras el canal siga offline con señal.
export async function kickQuietly(username: string) {
  try {
    await kickPublisher(username);
  } catch (err) {
    console.warn(`[stream] no se pudo cortar la señal de ${username}: ${err instanceof Error ? err.message : err}`);
  }
}

// RF-09.2
export const getStream: RequestHandler = (req, res) => {
  res.json(authOf(req).profile.toDashboard());
};

// RF-09.3, RF-09.4
export const regenerateKey: RequestHandler = async (req, res) => {
  const { profile } = authOf(req);
  const channel = profile.channel!;
  if (channel.status !== 'offline') throw new AppError('CHANNEL_LIVE');

  await channel.update({ streamKey: generateStreamKey() });
  res.json(profile.toDashboard());
};

// RF-10.1: offline → waiting. Si ya estaba iniciado solo actualiza el título.
export const startStream: RequestHandler = async (req, res) => {
  const { profile } = authOf(req);
  const channel = profile.channel!;
  const { title } = req.body as StartStreamBody;
  const titleChanged = title !== undefined && title !== channel.title;

  await channel.update({
    ...(channel.status === 'offline' ? { status: 'waiting' } : {}),
    ...(title !== undefined ? { title } : {}),
  });

  if (titleChanged) notifyTitle(profile);
  notifyStreamChange(profile);
  res.json(profile.toDashboard());
};

// RF-10.3: pasa a offline primero (así MediaMTX rechaza la reconexión de OBS) y después corta la señal.
export const stopStream: RequestHandler = async (req, res) => {
  const { profile } = authOf(req);
  await profile.channel!.update({ status: 'offline', liveStartedAt: null });
  notifyStreamChange(profile);
  await kickQuietly(profile.username);
  res.json(profile.toDashboard());
};

// RF-10.4
export const updateStream: RequestHandler = async (req, res) => {
  const { profile } = authOf(req);
  const { title } = req.body as UpdateStreamBody;
  await profile.channel!.update({ title });
  notifyTitle(profile);
  notifyStreamChange(profile);
  res.json(profile.toDashboard());
};
