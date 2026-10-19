import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { safeEqual } from '../utils/streamKey';

// Rutas internas para MediaMTX: exigen el secreto compartido en ?secret= (RF-11.3).
export const requireInternalSecret: RequestHandler = (req, _res, next) => {
  const secret = typeof req.query.secret === 'string' ? req.query.secret : '';
  if (!safeEqual(env.MEDIAMTX_SECRET, secret)) throw new AppError('UNAUTHORIZED');
  next();
};
