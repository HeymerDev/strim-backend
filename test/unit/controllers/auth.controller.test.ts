jest.mock('../../../src/config/supabase', () => require('../../helpers/supabase').mockSupabaseModule());

import { UniqueConstraintError } from 'sequelize';
import {
  forgotPassword,
  login,
  logout,
  refresh,
  register,
  resendOtp,
  resetPassword,
  verifyEmail,
} from '../../../src/controllers/auth.controller';
import { sequelize } from '../../../src/database';
import { AuthUser, Channel, Profile } from '../../../src/models';
import { mockRequest, mockResponse, runHandler } from '../../helpers/http';
import { buildAuth, buildProfile } from '../../helpers/models';
import { authError, fakeSession, publicAuth, resetSupabase, supabaseAdmin } from '../../helpers/supabase';

const EMAIL = 'ana@example.com';
const SESSION_EXPIRES_ISO = new Date(1_800_000_000 * 1000).toISOString();
const FAKE_TX = { id: 'tx' };

const authUser = (verified: boolean) =>
  AuthUser.build({ id: 'user-1', email: EMAIL, emailConfirmedAt: verified ? new Date() : null });

// sequelize.transaction(callback) ejecuta el callback con una transacción falsa.
function mockTransaction() {
  const spy = jest.spyOn(sequelize, 'transaction') as unknown as jest.Mock;
  spy.mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) => callback(FAKE_TX));
  return spy;
}

beforeEach(() => {
  resetSupabase();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('register', () => {
  const body = { email: EMAIL, username: 'ana', password: 'secreta123' };
  const newUser = { id: 'user-nuevo', email: EMAIL, identities: [{ id: 'identity-1' }] };

  // Camino feliz hasta signUp: el correo y el username están libres.
  function freeEmailAndUsername() {
    jest.spyOn(AuthUser, 'findByEmail').mockResolvedValue(null);
    return jest.spyOn(Profile, 'findOne').mockResolvedValue(null);
  }

  it('correo ya verificado → EMAIL_TAKEN sin llamar a Supabase', async () => {
    jest.spyOn(AuthUser, 'findByEmail').mockResolvedValue(authUser(true));

    await expect(runHandler(register, mockRequest({ body }))).rejects.toMatchObject({ code: 'EMAIL_TAKEN', status: 409 });
    expect(publicAuth.signUp).not.toHaveBeenCalled();
    expect(publicAuth.resend).not.toHaveBeenCalled();
  });

  it('correo sin verificar → reenvía el código y responde 200 verification_pending', async () => {
    jest.spyOn(AuthUser, 'findByEmail').mockResolvedValue(authUser(false));
    publicAuth.resend.mockResolvedValue({ data: {}, error: null });
    const res = mockResponse();

    await runHandler(register, mockRequest({ body }), res);

    expect(publicAuth.resend).toHaveBeenCalledWith({ type: 'signup', email: EMAIL });
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'verification_pending', email: EMAIL });
    expect(publicAuth.signUp).not.toHaveBeenCalled();
  });

  it('correo sin verificar y Supabase limita el reenvío → TOO_MANY_REQUESTS', async () => {
    jest.spyOn(AuthUser, 'findByEmail').mockResolvedValue(authUser(false));
    publicAuth.resend.mockResolvedValue({ data: {}, error: authError('over_email_send_rate_limit', 429) });

    await expect(runHandler(register, mockRequest({ body }))).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('username en uso → USERNAME_TAKEN sin crear la cuenta', async () => {
    jest.spyOn(AuthUser, 'findByEmail').mockResolvedValue(null);
    const findOne = jest.spyOn(Profile, 'findOne').mockResolvedValue(buildProfile({ username: 'ana' }));

    await expect(runHandler(register, mockRequest({ body }))).rejects.toMatchObject({ code: 'USERNAME_TAKEN', status: 409 });
    expect(findOne).toHaveBeenCalledWith({ where: { username: 'ana' } });
    expect(publicAuth.signUp).not.toHaveBeenCalled();
  });

  it('Supabase responde con identities: [] (el correo ya existía) → EMAIL_TAKEN', async () => {
    freeEmailAndUsername();
    publicAuth.signUp.mockResolvedValue({ data: { user: { ...newUser, identities: [] }, session: null }, error: null });
    const transaction = mockTransaction();

    await expect(runHandler(register, mockRequest({ body }))).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('un error de signUp se convierte con fromAuthError (weak_password → VALIDATION_ERROR)', async () => {
    freeEmailAndUsername();
    publicAuth.signUp.mockResolvedValue({ data: { user: null, session: null }, error: authError('weak_password', 422) });

    await expect(runHandler(register, mockRequest({ body }))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('lanza un error inesperado si Supabase no devuelve el usuario', async () => {
    freeEmailAndUsername();
    publicAuth.signUp.mockResolvedValue({ data: { user: null, session: null }, error: null });

    await expect(runHandler(register, mockRequest({ body }))).rejects.toThrow('Supabase no devolvió el usuario creado');
  });

  it('si la transacción falla por username repetido: borra el usuario de Supabase → USERNAME_TAKEN', async () => {
    freeEmailAndUsername();
    publicAuth.signUp.mockResolvedValue({ data: { user: newUser, session: null }, error: null });
    jest.spyOn(sequelize, 'transaction').mockRejectedValue(new UniqueConstraintError({ fields: { username: 'ana' } }));

    await expect(runHandler(register, mockRequest({ body }))).rejects.toMatchObject({ code: 'USERNAME_TAKEN' });
    expect(supabaseAdmin.auth.admin.deleteUser).toHaveBeenCalledWith('user-nuevo');
  });

  it('si la transacción falla por otro motivo: borra el usuario de Supabase y relanza el error', async () => {
    freeEmailAndUsername();
    publicAuth.signUp.mockResolvedValue({ data: { user: newUser, session: null }, error: null });
    const dbError = new Error('conexión perdida');
    jest.spyOn(sequelize, 'transaction').mockRejectedValue(dbError);

    await expect(runHandler(register, mockRequest({ body }))).rejects.toBe(dbError);
    expect(supabaseAdmin.auth.admin.deleteUser).toHaveBeenCalledWith('user-nuevo');
  });

  it('éxito: crea la cuenta, el perfil y el canal en una transacción y responde 201', async () => {
    freeEmailAndUsername();
    publicAuth.signUp.mockResolvedValue({ data: { user: newUser, session: null }, error: null });
    const transaction = mockTransaction();
    const createProfile = jest.spyOn(Profile, 'create').mockResolvedValue(buildProfile() as never);
    const createChannel = jest.spyOn(Channel, 'create').mockResolvedValue({} as never);
    const res = mockResponse();

    await runHandler(register, mockRequest({ body }), res);

    expect(publicAuth.signUp).toHaveBeenCalledWith({
      email: EMAIL,
      password: 'secreta123',
      options: { data: { username: 'ana' } },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(createProfile).toHaveBeenCalledWith(
      { id: 'user-nuevo', username: 'ana', displayName: 'ana' },
      { transaction: FAKE_TX },
    );
    expect(createChannel).toHaveBeenCalledWith(
      { userId: 'user-nuevo', streamKey: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/) },
      { transaction: FAKE_TX },
    );
    expect(supabaseAdmin.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ status: 'verification_pending', email: EMAIL });
  });
});

describe('verifyEmail', () => {
  const body = { email: EMAIL, otp: '123456' };

  it('código incorrecto → INVALID_OTP', async () => {
    publicAuth.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: authError('otp_expired', 403) });

    await expect(runHandler(verifyEmail, mockRequest({ body }))).rejects.toMatchObject({ code: 'INVALID_OTP', status: 400 });
  });

  it('sin sesión aunque no haya error → INVALID_OTP', async () => {
    publicAuth.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: null });

    await expect(runHandler(verifyEmail, mockRequest({ body }))).rejects.toMatchObject({ code: 'INVALID_OTP' });
  });

  it('Supabase limita los intentos → TOO_MANY_REQUESTS', async () => {
    publicAuth.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: authError('over_request_rate_limit', 429) });

    await expect(runHandler(verifyEmail, mockRequest({ body }))).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('código correcto → AuthSession con tokens y el usuario', async () => {
    const session = fakeSession({ id: 'user-1', email: EMAIL });
    publicAuth.verifyOtp.mockResolvedValue({ data: { user: session.user, session }, error: null });
    const profile = buildProfile({ id: 'user-1' });
    const findByPk = jest.spyOn(Profile, 'findByPk').mockResolvedValue(profile);
    const res = mockResponse();

    await runHandler(verifyEmail, mockRequest({ body }), res);

    expect(publicAuth.verifyOtp).toHaveBeenCalledWith({ email: EMAIL, token: '123456', type: 'email' });
    expect(findByPk).toHaveBeenCalledWith('user-1', { include: [Channel] });
    expect(res.json).toHaveBeenCalledWith({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: SESSION_EXPIRES_ISO,
      user: profile.toMe(EMAIL),
    });
  });

  it('código correcto pero sin perfil → UNAUTHORIZED', async () => {
    const session = fakeSession();
    publicAuth.verifyOtp.mockResolvedValue({ data: { user: session.user, session }, error: null });
    jest.spyOn(Profile, 'findByPk').mockResolvedValue(null);

    await expect(runHandler(verifyEmail, mockRequest({ body }))).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('resendOtp', () => {
  const MESSAGE = 'Si la cuenta existe y falta verificarla, te enviamos un código nuevo.';

  it('reenvía el código solo si la cuenta existe y no está verificada', async () => {
    jest.spyOn(AuthUser, 'findByEmail').mockResolvedValue(authUser(false));
    publicAuth.resend.mockResolvedValue({ data: {}, error: null });
    const res = mockResponse();

    await runHandler(resendOtp, mockRequest({ body: { email: EMAIL } }), res);

    expect(publicAuth.resend).toHaveBeenCalledWith({ type: 'signup', email: EMAIL });
    expect(res.json).toHaveBeenCalledWith({ message: MESSAGE });
  });

  it.each([
    ['no existe', null],
    ['ya está verificada', true],
  ])('si la cuenta %s no reenvía, pero responde lo mismo', async (_label, verified) => {
    jest.spyOn(AuthUser, 'findByEmail').mockResolvedValue(verified === null ? null : authUser(verified));
    const res = mockResponse();

    await runHandler(resendOtp, mockRequest({ body: { email: EMAIL } }), res);

    expect(publicAuth.resend).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: MESSAGE });
  });

  it('Supabase limita el reenvío → TOO_MANY_REQUESTS', async () => {
    jest.spyOn(AuthUser, 'findByEmail').mockResolvedValue(authUser(false));
    publicAuth.resend.mockResolvedValue({ data: {}, error: authError('over_email_send_rate_limit', 429) });

    await expect(runHandler(resendOtp, mockRequest({ body: { email: EMAIL } }))).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
  });
});

describe('login', () => {
  const body = { email: EMAIL, password: 'secreta123' };

  it('email_not_confirmed → EMAIL_NOT_VERIFIED', async () => {
    publicAuth.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: authError('email_not_confirmed', 400) });

    await expect(runHandler(login, mockRequest({ body }))).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED', status: 403 });
  });

  it('invalid_credentials → INVALID_CREDENTIALS', async () => {
    publicAuth.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: authError('invalid_credentials', 400) });

    await expect(runHandler(login, mockRequest({ body }))).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
  });

  it('otro error pasa por fromAuthError (límite → TOO_MANY_REQUESTS)', async () => {
    publicAuth.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: authError('over_request_rate_limit', 429) });

    await expect(runHandler(login, mockRequest({ body }))).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('éxito → AuthSession', async () => {
    const session = fakeSession({ id: 'user-1', email: EMAIL });
    publicAuth.signInWithPassword.mockResolvedValue({ data: { user: session.user, session }, error: null });
    const profile = buildProfile({ id: 'user-1' });
    jest.spyOn(Profile, 'findByPk').mockResolvedValue(profile);
    const res = mockResponse();

    await runHandler(login, mockRequest({ body }), res);

    expect(publicAuth.signInWithPassword).toHaveBeenCalledWith({ email: EMAIL, password: 'secreta123' });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'access-token', expiresAt: SESSION_EXPIRES_ISO, user: profile.toMe(EMAIL) }),
    );
  });
});

describe('refresh', () => {
  const body = { refreshToken: 'refresh-viejo' };

  it('refresh token inválido → UNAUTHORIZED', async () => {
    publicAuth.refreshSession.mockResolvedValue({ data: { user: null, session: null }, error: authError('refresh_token_not_found', 400) });

    await expect(runHandler(refresh, mockRequest({ body }))).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('sin sesión aunque no haya error → UNAUTHORIZED', async () => {
    publicAuth.refreshSession.mockResolvedValue({ data: { user: null, session: null }, error: null });

    await expect(runHandler(refresh, mockRequest({ body }))).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('Supabase limita → TOO_MANY_REQUESTS', async () => {
    publicAuth.refreshSession.mockResolvedValue({ data: { user: null, session: null }, error: authError('over_request_rate_limit', 429) });

    await expect(runHandler(refresh, mockRequest({ body }))).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('éxito → solo los tokens', async () => {
    const session = fakeSession();
    publicAuth.refreshSession.mockResolvedValue({ data: { user: session.user, session }, error: null });
    const res = mockResponse();

    await runHandler(refresh, mockRequest({ body }), res);

    expect(publicAuth.refreshSession).toHaveBeenCalledWith({ refresh_token: 'refresh-viejo' });
    expect(res.json).toHaveBeenCalledWith({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: SESSION_EXPIRES_ISO,
    });
  });

  it('sin expires_at calcula el vencimiento con expires_in', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const session = { ...fakeSession(), expires_at: undefined, expires_in: 3600 };
    publicAuth.refreshSession.mockResolvedValue({ data: { user: session.user, session }, error: null });
    const res = mockResponse();

    await runHandler(refresh, mockRequest({ body }), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: new Date((1_700_000_000 + 3600) * 1000).toISOString() }),
    );
  });
});

describe('logout', () => {
  it('cierra solo la sesión actual con signOut(token, "local") y responde 204', async () => {
    const res = mockResponse();

    await runHandler(logout, mockRequest({ auth: buildAuth(buildProfile(), { accessToken: 'mi-token' }) }), res);

    expect(supabaseAdmin.auth.admin.signOut).toHaveBeenCalledWith('mi-token', 'local');
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('sin req.auth → UNAUTHORIZED', async () => {
    await expect(runHandler(logout, mockRequest())).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(supabaseAdmin.auth.admin.signOut).not.toHaveBeenCalled();
  });
});

describe('forgotPassword', () => {
  const MESSAGE = { message: 'Si el correo está registrado, te enviamos un código.' };

  it('responde lo mismo si Supabase envía el código', async () => {
    publicAuth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    const res = mockResponse();

    await runHandler(forgotPassword, mockRequest({ body: { email: EMAIL } }), res);

    expect(publicAuth.resetPasswordForEmail).toHaveBeenCalledWith(EMAIL);
    expect(res.json).toHaveBeenCalledWith(MESSAGE);
  });

  it('responde lo mismo si Supabase falla por otro motivo (solo lo registra)', async () => {
    publicAuth.resetPasswordForEmail.mockResolvedValue({ data: null, error: authError('user_not_found', 404) });
    const res = mockResponse();

    await runHandler(forgotPassword, mockRequest({ body: { email: 'nadie@example.com' } }), res);

    expect(res.json).toHaveBeenCalledWith(MESSAGE);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('user_not_found'));
  });

  it('Supabase limita → TOO_MANY_REQUESTS', async () => {
    publicAuth.resetPasswordForEmail.mockResolvedValue({ data: null, error: authError('over_email_send_rate_limit', 429) });

    await expect(runHandler(forgotPassword, mockRequest({ body: { email: EMAIL } }))).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
  });
});

describe('resetPassword', () => {
  const body = { email: EMAIL, otp: '123456', newPassword: 'nueva1234' };

  it('código incorrecto → INVALID_OTP sin tocar la contraseña', async () => {
    publicAuth.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: authError('otp_expired', 403) });

    await expect(runHandler(resetPassword, mockRequest({ body }))).rejects.toMatchObject({ code: 'INVALID_OTP' });
    expect(supabaseAdmin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('Supabase limita → TOO_MANY_REQUESTS', async () => {
    publicAuth.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: authError('over_request_rate_limit', 429) });

    await expect(runHandler(resetPassword, mockRequest({ body }))).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('éxito: verifica con type recovery, guarda la contraseña y cierra todas las sesiones', async () => {
    const session = fakeSession({ id: 'user-1', email: EMAIL });
    publicAuth.verifyOtp.mockResolvedValue({ data: { user: session.user, session }, error: null });
    const res = mockResponse();

    await runHandler(resetPassword, mockRequest({ body }), res);

    expect(publicAuth.verifyOtp).toHaveBeenCalledWith({ email: EMAIL, token: '123456', type: 'recovery' });
    expect(supabaseAdmin.auth.admin.updateUserById).toHaveBeenCalledWith('user-1', { password: 'nueva1234' });
    expect(supabaseAdmin.auth.admin.signOut).toHaveBeenCalledWith('access-token', 'global');
    expect(res.json).toHaveBeenCalledWith({ message: 'Contraseña actualizada. Inicia sesión con la nueva.' });
  });

  it('si Supabase rechaza la contraseña nueva → VALIDATION_ERROR y no cierra sesiones', async () => {
    const session = fakeSession();
    publicAuth.verifyOtp.mockResolvedValue({ data: { user: session.user, session }, error: null });
    supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({ data: { user: null }, error: authError('weak_password', 422) });

    await expect(runHandler(resetPassword, mockRequest({ body }))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(supabaseAdmin.auth.admin.signOut).not.toHaveBeenCalled();
  });
});
