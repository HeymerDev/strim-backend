import { Router } from 'express';
import { getChannel, listLiveChannels } from '../controllers/channels.controller';

// /api/channels: público, sin sesión.
export const channelsRouter = Router();

// /live va antes que /:username ("live" es un username reservado).
channelsRouter.get('/live', listLiveChannels);
channelsRouter.get('/:username', getChannel);
