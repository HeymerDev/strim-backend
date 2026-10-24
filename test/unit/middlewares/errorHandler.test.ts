import { MulterError } from 'multer';
import { UniqueConstraintError } from 'sequelize';
import request from 'supertest';
import { z, ZodError } from 'zod';
import { createApp } from '../../../src/app';
import { errorHandler, notFound, toAppError, zodDetails } from '../../../src/middlewares/errorHandler';
import { AppError } from '../../../src/utils/AppError';
import { mockRequest, mockResponse, sentJson } from '../../helpers/http';

// ZodError real a partir de un esquema.
function zodErrorFor(schema: z.ZodType, value: unknown): ZodError {
  const result = schema.safeParse(value);
  if (result.success) throw new Error('se esperaba un error de validación');
  return result.error;
}

afterEach(() => jest.restoreAllMocks());

describe('zodDetails', () => {
  it('devuelve { campo: primer mensaje }, con rutas anidadas unidas por punto', () => {
    const schema = z.object({
      email: z.string().min(5, 'corto').regex(/@/, 'sin arroba'),
      profile: z.object({ name: z.string().min(1, 'vacío') }),
    });

    const details = zodDetails(zodErrorFor(schema, { email: 'ab', profile: { name: '' } }));

    expect(details).toEqual({ email: 'corto', 'profile.name': 'vacío' });
  });

  it('usa "_" para los errores sin ruta (por ejemplo, un refine del objeto)', () => {
    const schema = z.object({ a: z.string().optional() }).refine((value) => value.a !== undefined, 'falta algo');

    expect(zodDetails(zodErrorFor(schema, {}))).toEqual({ _: 'falta algo' });
  });
});

describe('toAppError', () => {
  it('devuelve el mismo AppError', () => {
    const error = new AppError('CHANNEL_LIVE');

    expect(toAppError(error)).toBe(error);
  });

  it('ZodError → VALIDATION_ERROR con details', () => {
    const error = zodErrorFor(z.object({ email: z.string().email('Correo inválido.') }), { email: 'x' });

    const result = toAppError(error);

    expect(result).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, details: { email: 'Correo inválido.' } });
  });

  it('MulterError → INVALID_FILE', () => {
    expect(toAppError(new MulterError('LIMIT_FILE_SIZE', 'avatar'))).toMatchObject({ code: 'INVALID_FILE', status: 400 });
  });

  it('UniqueConstraintError del username → USERNAME_TAKEN', () => {
    const error = new UniqueConstraintError({ fields: { username: 'ana' } });

    expect(toAppError(error)).toMatchObject({ code: 'USERNAME_TAKEN', status: 409 });
  });

  it('UniqueConstraintError de otro campo → null (error inesperado)', () => {
    expect(toAppError(new UniqueConstraintError({ fields: { stream_key: 'x' } }))).toBeNull();
    expect(toAppError(new UniqueConstraintError({}))).toBeNull();
  });

  it('JSON mal formado (entity.parse.failed) → VALIDATION_ERROR con mensaje propio', () => {
    const error = Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed' });

    expect(toAppError(error)).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'El cuerpo de la petición no es JSON válido.',
    });
  });

  it('body demasiado grande (entity.too.large) → PAYLOAD_TOO_LARGE', () => {
    const error = Object.assign(new Error('request entity too large'), { type: 'entity.too.large' });

    expect(toAppError(error)).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
  });

  it.each([
    ['un Error cualquiera', new Error('boom')],
    ['un texto', 'boom'],
    ['null', null],
    ['undefined', undefined],
    ['un objeto con otro type', { type: 'otra.cosa' }],
  ])('%s → null', (_label, error) => {
    expect(toAppError(error)).toBeNull();
  });
});

describe('notFound', () => {
  it('pasa un AppError NOT_FOUND a next()', () => {
    const next = jest.fn();

    notFound(mockRequest(), mockResponse() as never, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_FOUND', status: 404 }));
  });
});

describe('errorHandler', () => {
  it('responde un error conocido con su estado y { error }', () => {
    const res = mockResponse();

    errorHandler(new AppError('EMAIL_TAKEN'), mockRequest(), res as never, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(sentJson(res)).toEqual({ error: { code: 'EMAIL_TAKEN', message: 'Ese correo ya está registrado.' } });
  });

  it('responde un ZodError como 400 con details', () => {
    const res = mockResponse();
    const error = zodErrorFor(z.object({ title: z.string().max(3, 'largo') }), { title: 'abcd' });

    errorHandler(error, mockRequest(), res as never, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(sentJson(res)).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Hay datos inválidos.', details: { title: 'largo' } },
    });
  });

  it('un error desconocido → 500 INTERNAL_ERROR con la traza (no es producción) y lo registra', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = mockResponse();
    const error = new Error('se rompió');

    errorHandler(error, mockRequest({ method: 'POST', originalUrl: '/internal/mediamtx/auth?secret=abc' }), res as never, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    const body = sentJson(res) as { error: { code: string; message: string; details: { stack: string } } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Algo salió mal.');
    expect(body.error.details.stack).toContain('se rompió');
    // El log no incluye el query string (puede llevar el secreto).
    expect(consoleError).toHaveBeenCalledWith('[error] POST /internal/mediamtx/auth', error);
  });

  it('un valor lanzado que no es Error → 500 con details.stack = String(valor)', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = mockResponse();

    errorHandler('algo raro', mockRequest(), res as never, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(sentJson(res)).toMatchObject({ error: { code: 'INTERNAL_ERROR', details: { stack: 'algo raro' } } });
  });
});

describe('errorHandler en la app (supertest sobre createApp)', () => {
  const app = createApp();

  it('una ruta inexistente → 404 NOT_FOUND', async () => {
    const res = await request(app).get('/api/no-existe');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'No encontrado.' } });
  });

  it('JSON mal formado → 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/no-existe').set('Content-Type', 'application/json').send('{"malo":');

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: 'VALIDATION_ERROR', message: 'El cuerpo de la petición no es JSON válido.' });
  });

  it('body de más de 10 kB → 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(app)
      .post('/api/no-existe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ texto: 'a'.repeat(11 * 1024) }));

    expect(res.status).toBe(413);
    expect(res.body.error).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('GET /api/health responde { ok: true }', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
