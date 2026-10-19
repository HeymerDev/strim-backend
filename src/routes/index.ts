import { Router } from 'express';
import { health } from '../controllers/health.controller';
import { authRouter } from './auth.routes';
import { channelsRouter } from './channels.routes';
import { meRouter } from './me.routes';
import { streamRouter } from './stream.routes';

// Vistas de la API pública, montadas en /api.
export const apiRouter = Router();

apiRouter.get('/health', health);
apiRouter.use('/auth', authRouter);
apiRouter.use('/me', meRouter);
apiRouter.use('/stream', streamRouter);
apiRouter.use('/channels', channelsRouter);
