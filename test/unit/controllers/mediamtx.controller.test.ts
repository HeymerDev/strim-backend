import { ZodError } from 'zod';
import { authorizeMediaMtx } from '../../../src/controllers/mediamtx.controller';
import { Channel, Profile } from '../../../src/models';
import { mockRequest, mockResponse, runHandler } from '../../helpers/http';
import { buildProfile, STREAM_KEY } from '../../helpers/models';

const publish = (init: { path?: string; query?: string } = {}) =>
  mockRequest({ body: { action: 'publish', path: 'live/ana', query: `key=${STREAM_KEY}`, protocol: 'rtmp', ...init } });

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('authorizeMediaMtx', () => {
  it.each(['read', 'playback'])('%s → 200 sin consultar la base', async (action) => {
    const findOne = jest.spyOn(Profile, 'findOne').mockResolvedValue(null);
    const res = mockResponse();

    await runHandler(authorizeMediaMtx, mockRequest({ body: { action, path: 'live/ana' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.end).toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
  });

  it.each(['api', 'metrics', 'pprof', 'otra'])('la acción %s → UNAUTHORIZED', async (action) => {
    await expect(runHandler(authorizeMediaMtx, mockRequest({ body: { action } }))).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('lanza un ZodError si falta action', async () => {
    await expect(runHandler(authorizeMediaMtx, mockRequest({ body: {} }))).rejects.toBeInstanceOf(ZodError);
  });

  describe('publish', () => {
    it.each(['waiting', 'live'] as const)('canal %s con la clave correcta → 200', async (status) => {
      const findOne = jest.spyOn(Profile, 'findOne').mockResolvedValue(buildProfile({ username: 'ana' }, { status }));
      const res = mockResponse();

      await runHandler(authorizeMediaMtx, publish(), res);

      expect(findOne).toHaveBeenCalledWith({ where: { username: 'ana' }, include: [Channel] });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.end).toHaveBeenCalled();
    });

    it('acepta la clave entre otros parámetros del query', async () => {
      jest.spyOn(Profile, 'findOne').mockResolvedValue(buildProfile({}, { status: 'waiting' }));
      const res = mockResponse();

      await runHandler(authorizeMediaMtx, publish({ query: `foo=1&key=${STREAM_KEY}` }), res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('canal inexistente → UNAUTHORIZED', async () => {
      jest.spyOn(Profile, 'findOne').mockResolvedValue(null);

      await expect(runHandler(authorizeMediaMtx, publish())).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('canal inexistente'));
    });

    it('clave incorrecta → UNAUTHORIZED', async () => {
      jest.spyOn(Profile, 'findOne').mockResolvedValue(buildProfile({}, { status: 'waiting' }));

      await expect(runHandler(authorizeMediaMtx, publish({ query: 'key=otra-clave' }))).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('clave incorrecta'));
    });

    it('sin clave → UNAUTHORIZED', async () => {
      jest.spyOn(Profile, 'findOne').mockResolvedValue(buildProfile({}, { status: 'waiting' }));

      await expect(runHandler(authorizeMediaMtx, publish({ query: '' }))).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('canal offline con la clave correcta → UNAUTHORIZED', async () => {
      jest.spyOn(Profile, 'findOne').mockResolvedValue(buildProfile({}, { status: 'offline' }));

      await expect(runHandler(authorizeMediaMtx, publish())).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('canal offline'));
    });

    it.each(['otra/ana', 'live/Ana', 'live/ana/extra', ''])(
      'ruta "%s" que no es live/<username> → UNAUTHORIZED sin consultar la base',
      async (path) => {
        const findOne = jest.spyOn(Profile, 'findOne').mockResolvedValue(null);

        await expect(runHandler(authorizeMediaMtx, publish({ path }))).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        expect(findOne).not.toHaveBeenCalled();
      },
    );
  });
});
