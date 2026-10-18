import { Router } from 'express';
import { health } from '../controllers/health.controller';

// Vistas de la API pública, montadas en /api.
export const apiRouter = Router();

apiRouter.get('/health', health);
