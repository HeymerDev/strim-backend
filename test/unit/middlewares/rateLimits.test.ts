import express from 'express';
import request from 'supertest';
import { createApp } from '../../../src/app';
import { errorHandler } from '../../../src/middlewares/errorHandler';
import { sensitiveLimiter } from '../../../src/middlewares/rateLimits';
import type { AuthContext } from '../../../src/middlewares/requireAuth';

// Los limitadores guardan los contadores en memoria del módulo: cada prueba usa su propia clave
// (otra app, otra ruta o otro usuario) para no depender de las demás.

describe('authLimiter (/api/auth/*)', () => {
  it('la 11.ª petición en un minuto desde la misma IP → 429 TOO_MANY_REQUESTS', async () => {
    const app = createApp();
    // Body inválido: validate responde 400 sin llegar a Supabase, pero la petición cuenta igual.
    const send = () => request(app).post('/api/auth/login').send({});

    for (let i = 1; i <= 10; i++) {
      const res = await send();
      expect(res.status).toBe(400);
    }

    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiados intentos. Espera un momento.' },
    });

    // El límite solo aplica a /api/auth.
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
  });
});

describe('sensitiveLimiter', () => {
  // App mínima: el header x-user hace de requireAuth; ?ok=1 responde 204, si no 400.
  function sensitiveApp() {
    const app = express();
    app.use((req, _res, next) => {
      const userId = req.get('x-user');
      if (userId) req.auth = { userId } as AuthContext;
      next();
    });
    app.post('/sensible', sensitiveLimiter, (req, res) => {
      res.status(req.query.ok === '1' ? 204 : 400).end();
    });
    app.use(errorHandler);
    return app;
  }

  it('el 6.º fallo de un usuario en 15 min → 429; otro usuario no se ve afectado', async () => {
    const app = sensitiveApp();
    const fail = (userId: string) => request(app).post('/sensible').set('x-user', userId);

    for (let i = 1; i <= 5; i++) {
      expect((await fail('usuario-a')).status).toBe(400);
    }

    const blocked = await fail('usuario-a');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatchObject({ code: 'TOO_MANY_REQUESTS' });

    expect((await fail('usuario-b')).status).toBe(400);
  });

  it('las respuestas exitosas no cuentan', async () => {
    const app = sensitiveApp();

    for (let i = 1; i <= 8; i++) {
      const res = await request(app).post('/sensible?ok=1').set('x-user', 'usuario-c');
      expect(res.status).toBe(204);
    }

    // Después de 8 éxitos, todavía quedan los 5 fallos permitidos.
    expect((await request(app).post('/sensible').set('x-user', 'usuario-c')).status).toBe(400);
  });
});
