import type { RequestHandler } from 'express';
import { Channel, Profile } from '../models';
import { getViewers } from '../sockets/emit';
import { AppError } from '../utils/AppError';

// RF-13: datos públicos de un canal (sin correo ni stream key).
export const getChannel: RequestHandler = async (req, res) => {
  const username = String(req.params.username).toLowerCase();
  const profile = await Profile.findOne({ where: { username }, include: [Channel] });
  if (!profile?.channel) throw new AppError('NOT_FOUND');

  res.json(profile.toPublic(getViewers(profile.id)));
};

// RF-17: canales en vivo, los más vistos primero.
export const listLiveChannels: RequestHandler = async (_req, res) => {
  const profiles = await Profile.findAll({ include: [{ model: Channel, where: { status: 'live' } }] });
  const channels = profiles
    .map((profile) => profile.toPublic(getViewers(profile.id)))
    .sort((a, b) => b.viewers - a.viewers);

  res.json(channels);
};
