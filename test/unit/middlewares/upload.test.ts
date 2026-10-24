import express from 'express';
import request from 'supertest';
import { AVATAR_MAX_BYTES } from '../../../src/config/supabase';
import { errorHandler } from '../../../src/middlewares/errorHandler';
import { avatarUpload } from '../../../src/middlewares/upload';

// App mínima: el middleware real de multer y un controlador que describe el archivo recibido.
function uploadApp() {
  const app = express();
  app.put('/avatar', avatarUpload, (req, res) => {
    res.json({
      mimetype: req.file?.mimetype ?? null,
      size: req.file?.size ?? null,
      inMemory: Buffer.isBuffer(req.file?.buffer),
    });
  });
  app.use(errorHandler);
  return app;
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('avatarUpload', () => {
  it.each([
    ['image/jpeg', 'avatar.jpg'],
    ['image/png', 'avatar.png'],
    ['image/webp', 'avatar.webp'],
  ])('acepta %s y deja el archivo en memoria', async (contentType, filename) => {
    const res = await request(uploadApp()).put('/avatar').attach('avatar', PNG_BYTES, { filename, contentType });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mimetype: contentType, size: PNG_BYTES.length, inMemory: true });
  });

  it.each([
    ['image/gif', 'avatar.gif'],
    ['image/svg+xml', 'avatar.svg'],
    ['application/pdf', 'avatar.pdf'],
  ])('rechaza %s → 400 INVALID_FILE', async (contentType, filename) => {
    const res = await request(uploadApp()).put('/avatar').attach('avatar', PNG_BYTES, { filename, contentType });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'INVALID_FILE' });
  });

  it('rechaza un archivo de más de 2 MB → 400 INVALID_FILE', async () => {
    const big = Buffer.alloc(AVATAR_MAX_BYTES + 1, 0x61);

    const res = await request(uploadApp())
      .put('/avatar')
      .attach('avatar', big, { filename: 'avatar.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'INVALID_FILE' });
  });

  it('rechaza un archivo en otro campo → 400 INVALID_FILE', async () => {
    const res = await request(uploadApp())
      .put('/avatar')
      .attach('foto', PNG_BYTES, { filename: 'avatar.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'INVALID_FILE' });
  });

  it('sin archivo deja req.file vacío (lo rechaza el controlador)', async () => {
    const res = await request(uploadApp()).put('/avatar').field('nombre', 'x');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mimetype: null, size: null, inMemory: false });
  });
});
