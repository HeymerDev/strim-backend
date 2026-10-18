import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

type Schemas = { body?: ZodType; params?: ZodType; query?: ZodType };

// Valida y normaliza la entrada antes del controlador (RNF-05).
// Un ZodError llega al errorHandler como VALIDATION_ERROR.
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
    if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
    if (schemas.query) {
      // En Express 5 req.query es un getter: se reemplaza con una propiedad propia.
      Object.defineProperty(req, 'query', {
        value: schemas.query.parse(req.query),
        writable: true,
        enumerable: true,
      });
    }
    next();
  };
