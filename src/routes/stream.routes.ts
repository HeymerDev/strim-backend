import { Router } from 'express';
import { getStream, regenerateKey, startStream, stopStream, updateStream } from '../controllers/stream.controller';
import { requireAuth } from '../middlewares/requireAuth';
import { validate } from '../middlewares/validate';
import { startStreamBody, updateStreamBody } from '../validators/stream';

// /api/stream: dashboard del streamer.
export const streamRouter = Router();

streamRouter.use(requireAuth);

streamRouter.get('/', getStream);
streamRouter.patch('/', validate({ body: updateStreamBody }), updateStream);
streamRouter.post('/key', regenerateKey);
streamRouter.post('/start', validate({ body: startStreamBody }), startStream);
streamRouter.post('/stop', stopStream);
