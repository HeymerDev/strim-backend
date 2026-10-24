import express, { type Request } from 'express';
import request from 'supertest';
import { z, ZodError } from 'zod';
import { errorHandler } from '../../../src/middlewares/errorHandler';
import { validate } from '../../../src/middlewares/validate';
import { mockRequest, mockResponse, runHandler } from '../../helpers/http';

const bodySchema = z.object({ email: z.string().trim().toLowerCase(), age: z.coerce.number().optional() });
const paramsSchema = z.object({ username: z.string().toLowerCase() });
const querySchema = z.object({ page: z.coerce.number().int().min(1).default(1) });

// Como en Express 5: req.query es un getter heredado (no una propiedad propia).
function requestWithQueryGetter(query: Record<string, unknown>): Request {
  const proto = {
    get query() {
      return query;
    },
  };
  const req = Object.create(proto) as Request;
  req.body = {};
  req.params = {};
  return req;
}

describe('validate', () => {
  it('valida y normaliza el body, y llama a next()', async () => {
    const req = mockRequest({ body: { email: '  ANA@Example.com ', age: '30', extra: 'x' } });
    const next = jest.fn();

    await runHandler(validate({ body: bodySchema }), req, mockResponse(), next);

    expect(req.body).toEqual({ email: 'ana@example.com', age: 30 });
    expect(next).toHaveBeenCalledWith();
  });

  it('valida un body ausente como {}', async () => {
    const req = mockRequest();
    req.body = undefined;

    await runHandler(validate({ body: z.object({ title: z.string().optional() }) }), req);

    expect(req.body).toEqual({});
  });

  it('lanza un ZodError con un body inválido y no llama a next()', async () => {
    const req = mockRequest({ body: { age: 'no-es-numero' } });
    const next = jest.fn();

    await expect(runHandler(validate({ body: bodySchema }), req, mockResponse(), next)).rejects.toBeInstanceOf(ZodError);
    expect(next).not.toHaveBeenCalled();
  });

  it('valida y reemplaza params', async () => {
    const req = mockRequest({ params: { username: 'ANA' } });

    await runHandler(validate({ params: paramsSchema }), req);

    expect(req.params).toEqual({ username: 'ana' });
  });

  it('reemplaza req.query aunque en Express 5 sea un getter', async () => {
    const req = requestWithQueryGetter({ page: '3' });
    const next = jest.fn();

    await runHandler(validate({ query: querySchema }), req, mockResponse(), next);

    expect(req.query).toEqual({ page: 3 });
    expect(Object.getOwnPropertyDescriptor(req, 'query')).toMatchObject({ writable: true, enumerable: true });
    expect(next).toHaveBeenCalledWith();
  });

  it('aplica los valores por defecto del esquema de query', async () => {
    const req = requestWithQueryGetter({});

    await runHandler(validate({ query: querySchema }), req);

    expect(req.query).toEqual({ page: 1 });
  });

  it('lanza un ZodError con un query inválido', async () => {
    const req = requestWithQueryGetter({ page: '0' });

    await expect(runHandler(validate({ query: querySchema }), req)).rejects.toBeInstanceOf(ZodError);
  });

  it('sin esquemas no toca la petición', async () => {
    const body = { a: 1 };
    const req = mockRequest({ body });
    const next = jest.fn();

    await runHandler(validate({}), req, mockResponse(), next);

    expect(req.body).toBe(body);
    expect(next).toHaveBeenCalledWith();
  });

  it('en una app de Express 5 real, el controlador recibe el query validado y un error responde 400', async () => {
    const app = express();
    app.get('/items', validate({ query: querySchema }), (req, res) => {
      res.json({ query: req.query, type: typeof req.query.page });
    });
    app.use(errorHandler);

    const ok = await request(app).get('/items?page=2');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ query: { page: 2 }, type: 'number' });

    const bad = await request(app).get('/items?page=abc');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { page: expect.any(String) } });
  });
});
