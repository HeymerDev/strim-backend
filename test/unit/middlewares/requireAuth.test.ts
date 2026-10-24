jest.mock('../../../src/config/supabase', () => require('../../helpers/supabase').mockSupabaseModule());

import { authenticateToken, authOf, requireAuth } from '../../../src/middlewares/requireAuth';
import { Channel, Profile } from '../../../src/models';
import { mockRequest, mockResponse, runHandler } from '../../helpers/http';
import { buildAuth, buildProfile } from '../../helpers/models';
import { authError, resetSupabase, supabaseAdmin } from '../../helpers/supabase';

const getClaims = supabaseAdmin.auth.getClaims;

const validClaims = (claims: Record<string, unknown> = {}) => ({
  data: { claims: { sub: 'user-1', email: 'ana@example.com', exp: 1_800_000_000, ...claims }, header: {}, signature: {} },
  error: null,
});

beforeEach(() => resetSupabase());
afterEach(() => jest.restoreAllMocks());

describe('authenticateToken', () => {
  it('devuelve null si getClaims lanza (token sin forma de JWT)', async () => {
    getClaims.mockRejectedValue(new Error('Invalid JWT structure'));
    const findByPk = jest.spyOn(Profile, 'findByPk').mockResolvedValue(null);

    await expect(authenticateToken('no-es-jwt')).resolves.toBeNull();
    expect(findByPk).not.toHaveBeenCalled();
  });

  it('devuelve null si getClaims responde { error }', async () => {
    getClaims.mockResolvedValue({ data: null, error: authError('bad_jwt', 401) });
    const findByPk = jest.spyOn(Profile, 'findByPk').mockResolvedValue(null);

    await expect(authenticateToken('token-vencido')).resolves.toBeNull();
    expect(findByPk).not.toHaveBeenCalled();
  });

  it('devuelve null si getClaims no devuelve datos', async () => {
    getClaims.mockResolvedValue({ data: null, error: null });

    await expect(authenticateToken('token')).resolves.toBeNull();
  });

  it('devuelve null si el perfil no existe (cuenta borrada)', async () => {
    getClaims.mockResolvedValue(validClaims());
    jest.spyOn(Profile, 'findByPk').mockResolvedValue(null);

    await expect(authenticateToken('token')).resolves.toBeNull();
  });

  it('devuelve null si el perfil no tiene canal', async () => {
    getClaims.mockResolvedValue(validClaims());
    jest.spyOn(Profile, 'findByPk').mockResolvedValue(buildProfile({}, null));

    await expect(authenticateToken('token')).resolves.toBeNull();
  });

  it('con un token válido devuelve el contexto y carga el perfil con su canal', async () => {
    const profile = buildProfile({ id: 'user-1' });
    getClaims.mockResolvedValue(validClaims());
    const findByPk = jest.spyOn(Profile, 'findByPk').mockResolvedValue(profile);

    const auth = await authenticateToken('token-ok');

    expect(getClaims).toHaveBeenCalledWith('token-ok');
    expect(findByPk).toHaveBeenCalledWith('user-1', { include: [Channel] });
    expect(auth).toEqual({
      userId: 'user-1',
      email: 'ana@example.com',
      accessToken: 'token-ok',
      exp: 1_800_000_000,
      profile,
    });
  });

  it('usa "" como correo si el token no lo trae', async () => {
    getClaims.mockResolvedValue(validClaims({ email: undefined }));
    jest.spyOn(Profile, 'findByPk').mockResolvedValue(buildProfile());

    expect((await authenticateToken('token'))?.email).toBe('');
  });
});

describe('requireAuth', () => {
  it('sin header Authorization → UNAUTHORIZED, sin consultar a Supabase', async () => {
    const next = jest.fn();

    await expect(runHandler(requireAuth, mockRequest(), mockResponse(), next)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    });
    expect(getClaims).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['Basic abc', 'bearer abc', 'Bearer ', 'Bearer    '])('header "%s" → UNAUTHORIZED', async (authorization) => {
    const req = mockRequest({ headers: { authorization } });

    await expect(runHandler(requireAuth, req)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(getClaims).not.toHaveBeenCalled();
  });

  it('token que hace lanzar a getClaims → UNAUTHORIZED', async () => {
    getClaims.mockRejectedValue(new Error('Invalid JWT structure'));
    const req = mockRequest({ headers: { authorization: 'Bearer basura' } });

    await expect(runHandler(requireAuth, req)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('getClaims responde { error } → UNAUTHORIZED', async () => {
    getClaims.mockResolvedValue({ data: null, error: authError('bad_jwt', 401) });
    const req = mockRequest({ headers: { authorization: 'Bearer vencido' } });

    await expect(runHandler(requireAuth, req)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('perfil inexistente → UNAUTHORIZED', async () => {
    getClaims.mockResolvedValue(validClaims());
    jest.spyOn(Profile, 'findByPk').mockResolvedValue(null);
    const req = mockRequest({ headers: { authorization: 'Bearer token' } });

    await expect(runHandler(requireAuth, req)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('con un token válido deja req.auth y llama a next()', async () => {
    const profile = buildProfile();
    getClaims.mockResolvedValue(validClaims());
    jest.spyOn(Profile, 'findByPk').mockResolvedValue(profile);
    const req = mockRequest({ headers: { authorization: 'Bearer  token-ok ' } });
    const next = jest.fn();

    await runHandler(requireAuth, req, mockResponse(), next);

    expect(getClaims).toHaveBeenCalledWith('token-ok');
    expect(req.auth).toMatchObject({ userId: 'user-1', email: 'ana@example.com', accessToken: 'token-ok', profile });
    expect(next).toHaveBeenCalledWith();
  });
});

describe('authOf', () => {
  it('lanza UNAUTHORIZED si no hay req.auth', () => {
    expect(() => authOf(mockRequest())).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  it('devuelve req.auth', () => {
    const auth = buildAuth();

    expect(authOf(mockRequest({ auth }))).toBe(auth);
  });
});
