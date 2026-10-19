import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, isProduction } from './config/env';
import { errorHandler, notFound } from './middlewares/errorHandler';
import { apiRouter } from './routes';
import { internalRouter } from './routes/internal.routes';

// Sin query string en el log: la ruta interna de MediaMTX lleva el secreto ahí.
morgan.token('path', (req) => (req as express.Request).originalUrl.split('?')[0]);

export function createApp() {
  const app = express();
  if (!isProduction) app.set('json spaces', 2);

  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_URL }));
  app.use(express.json({ limit: '10kb' }));
  app.use(morgan(':method :path :status :response-time ms', { skip: () => env.NODE_ENV === 'test' }));

  app.use('/api', apiRouter);
  app.use('/internal', internalRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
