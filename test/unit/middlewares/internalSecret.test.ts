import { env } from '../../../src/config/env';
import { requireInternalSecret } from '../../../src/middlewares/internalSecret';
import { mockRequest, mockResponse, runHandler } from '../../helpers/http';

describe('requireInternalSecret', () => {
  it('sin ?secret= → UNAUTHORIZED', async () => {
    const next = jest.fn();

    await expect(runHandler(requireInternalSecret, mockRequest(), mockResponse(), next)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('con un secreto incorrecto → UNAUTHORIZED', async () => {
    const req = mockRequest({ query: { secret: 'no-es-el-secreto' } });

    await expect(runHandler(requireInternalSecret, req)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('con un secreto del mismo largo pero distinto → UNAUTHORIZED', async () => {
    const almost = `${env.MEDIAMTX_SECRET.slice(0, -1)}#`;
    const req = mockRequest({ query: { secret: almost } });

    await expect(runHandler(requireInternalSecret, req)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('con ?secret= repetido (array) → UNAUTHORIZED', async () => {
    const req = mockRequest({ query: { secret: [env.MEDIAMTX_SECRET, env.MEDIAMTX_SECRET] } });

    await expect(runHandler(requireInternalSecret, req)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('con el secreto correcto llama a next()', async () => {
    const req = mockRequest({ query: { secret: env.MEDIAMTX_SECRET } });
    const next = jest.fn();

    await runHandler(requireInternalSecret, req, mockResponse(), next);

    expect(next).toHaveBeenCalledWith();
  });
});
