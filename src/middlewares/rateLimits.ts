import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../utils/AppError';

const handler: RequestHandler = (_req, _res, next) => {
  next(new AppError('TOO_MANY_REQUESTS'));
};

// Rutas /api/auth/*: 10 peticiones por minuto por IP (RNF-07).
export const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler,
});

// Cambiar la contraseña y borrar la cuenta: 5 fallos cada 15 min por usuario (RF-07.4, RF-08.2).
// Va después de requireAuth. Las respuestas exitosas no cuentan.
export const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.userId ?? 'anonymous',
  handler,
});
