import type { ErrorRequestHandler, RequestHandler } from 'express';
import { MulterError } from 'multer';
import { UniqueConstraintError } from 'sequelize';
import { ZodError } from 'zod';
import { isProduction } from '../config/env';
import { AppError } from '../utils/AppError';

// { campo: primer mensaje } a partir de los issues de zod.
export function zodDetails(error: ZodError): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path.join('.') || '_';
    details[field] ??= issue.message;
  }
  return details;
}

// Errores conocidos → AppError. null = error inesperado (500). También lo usa el socket.
export function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return new AppError('VALIDATION_ERROR', undefined, zodDetails(err));
  if (err instanceof MulterError) return new AppError('INVALID_FILE');
  if (err instanceof UniqueConstraintError && 'username' in (err.fields ?? {})) {
    return new AppError('USERNAME_TAKEN');
  }

  // Errores de express.json(): JSON mal formado o body demasiado grande.
  const type = (err as { type?: string } | null)?.type;
  if (type === 'entity.parse.failed') {
    return new AppError('VALIDATION_ERROR', 'El cuerpo de la petición no es JSON válido.');
  }
  if (type === 'entity.too.large') return new AppError('PAYLOAD_TOO_LARGE');

  return null;
}

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new AppError('NOT_FOUND'));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const known = toAppError(err);
  if (known) {
    res.status(known.status).json({ error: known });
    return;
  }

  console.error(`[error] ${req.method} ${req.originalUrl.split('?')[0]}`, err);
  const internal = new AppError(
    'INTERNAL_ERROR',
    undefined,
    isProduction ? undefined : { stack: err instanceof Error ? err.stack : String(err) },
  );
  res.status(internal.status).json({ error: internal });
};
