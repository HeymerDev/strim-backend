import type { RequestHandler } from 'express';
import { z } from 'zod';
import { usernameFromPath } from '../config/mediamtx';
import { Channel, Profile } from '../models';
import { AppError } from '../utils/AppError';
import { safeEqual } from '../utils/streamKey';

// Lo que MediaMTX manda en cada pedido de autorización (solo usamos estos campos).
const authRequest = z.object({
  action: z.string(),
  path: z.string().default(''),
  query: z.string().default(''),
});

// RF-11: cualquier respuesta distinta de 2xx hace que MediaMTX rechace la acción.
export const authorizeMediaMtx: RequestHandler = async (req, res) => {
  const { action, path, query } = authRequest.parse(req.body);

  // Ver es público (RF-11.2). MediaMTX ya no pregunta por estas acciones, pero se aceptan igual.
  if (action === 'read' || action === 'playback') {
    res.status(200).end();
    return;
  }
  if (action !== 'publish') throw new AppError('UNAUTHORIZED');

  // OBS: servidor rtmp://<host>:1935/live y clave "<username>?key=<streamKey>" → path live/<username>, query key=…
  const username = usernameFromPath(path);
  const key = new URLSearchParams(query).get('key') ?? '';
  const profile = username ? await Profile.findOne({ where: { username }, include: [Channel] }) : null;
  const channel = profile?.channel;

  if (!channel || !key || !safeEqual(channel.streamKey, key) || channel.status === 'offline') {
    const reason = !channel ? 'canal inexistente' : channel.status === 'offline' ? 'canal offline' : 'clave incorrecta';
    console.warn(`[mediamtx] señal rechazada en "${path}": ${reason}`);
    throw new AppError('UNAUTHORIZED');
  }

  res.status(200).end();
};
