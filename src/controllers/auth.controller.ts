import type { Session } from '@supabase/supabase-js';
import type { RequestHandler } from 'express';
import { UniqueConstraintError } from 'sequelize';
import { createPublicClient, supabaseAdmin } from '../config/supabase';
import { sequelize } from '../database';
import { authOf } from '../middlewares/requireAuth';
import { AuthUser, Channel, Profile } from '../models';
import type {
  EmailBody,
  LoginBody,
  RefreshBody,
  RegisterBody,
  ResetPasswordBody,
  VerifyEmailBody,
} from '../validators/auth';
import { AppError } from '../utils/AppError';
import { fromAuthError, isRateLimited } from '../utils/authErrors';
import { generateStreamKey } from '../utils/streamKey';

function toTokens(session: Session) {
  const expiresAt = session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in;
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

// Tokens + datos del usuario (AuthSession, diseño §6).
async function toAuthSession(session: Session) {
  const profile = await Profile.findByPk(session.user.id, { include: [Channel] });
  if (!profile) throw new AppError('UNAUTHORIZED');
  return { ...toTokens(session), user: profile.toMe(session.user.email ?? '') };
}

async function resendSignupOtp(email: string) {
  const { error } = await createPublicClient().auth.resend({ type: 'signup', email });
  if (error) throw fromAuthError(error);
}

// RF-01
export const register: RequestHandler = async (req, res) => {
  const { email, username, password } = req.body as RegisterBody;

  const existing = await AuthUser.findByEmail(email);
  if (existing?.isVerified) throw new AppError('EMAIL_TAKEN');
  if (existing) {
    // Ya se registró pero no verificó: se reenvía el código (RF-01.4).
    await resendSignupOtp(email);
    res.json({ status: 'verification_pending', email });
    return;
  }

  if (await Profile.findOne({ where: { username } })) throw new AppError('USERNAME_TAKEN');

  const { data, error } = await createPublicClient().auth.signUp({
    email,
    password,
    options: { data: { username } },
  });
  if (error) throw fromAuthError(error);
  const user = data.user;
  if (!user) throw new Error('Supabase no devolvió el usuario creado');
  // Supabase responde sin identidades cuando el correo ya existía.
  if (user.identities?.length === 0) throw new AppError('EMAIL_TAKEN');

  try {
    await sequelize.transaction(async (transaction) => {
      await Profile.create({ id: user.id, username, displayName: username }, { transaction });
      await Channel.create({ userId: user.id, streamKey: generateStreamKey() }, { transaction });
    });
  } catch (err) {
    // Sin perfil la cuenta no sirve: se deshace en Supabase.
    await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (err instanceof UniqueConstraintError) throw new AppError('USERNAME_TAKEN');
    throw err;
  }

  res.status(201).json({ status: 'verification_pending', email });
};

// RF-02.1, RF-02.2
export const verifyEmail: RequestHandler = async (req, res) => {
  const { email, otp } = req.body as VerifyEmailBody;
  const { data, error } = await createPublicClient().auth.verifyOtp({ email, token: otp, type: 'email' });
  if (error && isRateLimited(error)) throw new AppError('TOO_MANY_REQUESTS');
  if (error || !data.session) throw new AppError('INVALID_OTP');

  res.json(await toAuthSession(data.session));
};

// RF-02.3, RF-02.4
export const resendOtp: RequestHandler = async (req, res) => {
  const { email } = req.body as EmailBody;
  const existing = await AuthUser.findByEmail(email);
  if (existing && !existing.isVerified) await resendSignupOtp(email);

  res.json({ message: 'Si la cuenta existe y falta verificarla, te enviamos un código nuevo.' });
};

// RF-03
export const login: RequestHandler = async (req, res) => {
  const { email, password } = req.body as LoginBody;
  const { data, error } = await createPublicClient().auth.signInWithPassword({ email, password });
  if (error?.code === 'email_not_confirmed') throw new AppError('EMAIL_NOT_VERIFIED');
  if (error?.code === 'invalid_credentials') throw new AppError('INVALID_CREDENTIALS');
  if (error) throw fromAuthError(error);

  res.json(await toAuthSession(data.session));
};

// RF-04.3
export const refresh: RequestHandler = async (req, res) => {
  const { refreshToken } = req.body as RefreshBody;
  const { data, error } = await createPublicClient().auth.refreshSession({ refresh_token: refreshToken });
  if (error && isRateLimited(error)) throw new AppError('TOO_MANY_REQUESTS');
  if (error || !data.session) throw new AppError('UNAUTHORIZED');

  res.json(toTokens(data.session));
};

// RF-04.4: invalida el refresh token de esta sesión.
export const logout: RequestHandler = async (req, res) => {
  await supabaseAdmin.auth.admin.signOut(authOf(req).accessToken, 'local');
  res.status(204).end();
};

// RF-05.1: misma respuesta exista o no la cuenta.
export const forgotPassword: RequestHandler = async (req, res) => {
  const { email } = req.body as EmailBody;
  const { error } = await createPublicClient().auth.resetPasswordForEmail(email);
  if (error && isRateLimited(error)) throw new AppError('TOO_MANY_REQUESTS');
  if (error) console.warn(`[auth] resetPasswordForEmail falló: ${error.code ?? error.message}`);

  res.json({ message: 'Si el correo está registrado, te enviamos un código.' });
};

// RF-05.2 a RF-05.4
export const resetPassword: RequestHandler = async (req, res) => {
  const { email, otp, newPassword } = req.body as ResetPasswordBody;
  const { data, error } = await createPublicClient().auth.verifyOtp({ email, token: otp, type: 'recovery' });
  if (error && isRateLimited(error)) throw new AppError('TOO_MANY_REQUESTS');
  if (error || !data.session || !data.user) throw new AppError('INVALID_OTP');

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
    password: newPassword,
  });
  if (updateError) throw fromAuthError(updateError);

  // Cierra todas las sesiones abiertas de la cuenta.
  await supabaseAdmin.auth.admin.signOut(data.session.access_token, 'global');

  res.json({ message: 'Contraseña actualizada. Inicia sesión con la nueva.' });
};
