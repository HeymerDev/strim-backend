import { Router } from 'express';
import { health } from '../controllers/health.controller';
import { authRouter } from './auth.routes';
import { meRouter } from './me.routes';

// Vistas de la API pública, montadas en /api.
export const apiRouter = Router();

apiRouter.get('/health', health);
apiRouter.use('/auth', authRouter);
apiRouter.use('/me', meRouter);
