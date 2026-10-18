import type { Request, RequestHandler } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { Channel, Profile } from '../models';
import { AppError } from '../utils/AppError';

export type AuthContext = {
  userId: string;
  email: string;
  accessToken: string;
  // Vencimiento del token, en segundos Unix.
  exp: number;
  // Perfil con su canal cargado.
  profile: Profile;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// Valida un access token de Supabase y carga el perfil del usuario.
// Devuelve null si el token no es válido o la cuenta ya no existe (RF-08.5).
// También lo usa el socket.
export async function authenticateToken(token: string): Promise<AuthContext | null> {
  // getClaims lanza (en vez de devolver error) si el token ni siquiera tiene forma de JWT.
  const result = await supabaseAdmin.auth.getClaims(token).catch(() => null);
  if (!result || result.error || !result.data) return null;

  const { sub, email, exp } = result.data.claims;
  const profile = await Profile.findByPk(sub, { include: [Channel] });
  if (!profile?.channel) return null;

  return { userId: sub, email: email ?? '', accessToken: token, exp, profile };
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) throw new AppError('UNAUTHORIZED');

  const auth = await authenticateToken(token);
  if (!auth) throw new AppError('UNAUTHORIZED');

  req.auth = auth;
  next();
};

// Para los controladores que van detrás de requireAuth.
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw new AppError('UNAUTHORIZED');
  return req.auth;
}
