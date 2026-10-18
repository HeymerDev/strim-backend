import type { RequestHandler } from 'express';
import { AVATARS_BUCKET, createPublicClient, supabaseAdmin } from '../config/supabase';
import { authOf } from '../middlewares/requireAuth';
import { AppError } from '../utils/AppError';
import { fromAuthError, isRateLimited } from '../utils/authErrors';
import type { ChangePasswordBody, UpdateMeBody } from '../validators/me';

// Firma de los primeros bytes de cada formato: el tipo que manda el cliente no basta.
const AVATAR_FORMATS = {
  'image/jpeg': { ext: 'jpg', matches: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', matches: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', matches: (b: Buffer) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
} as const;

// Borra los avatares del usuario en Storage, salvo `keep`.
export async function removeAvatars(userId: string, keep?: string) {
  const bucket = supabaseAdmin.storage.from(AVATARS_BUCKET);
  const { data: files, error } = await bucket.list(userId);
  if (error) throw error;
  const paths = files.map((file) => `${userId}/${file.name}`).filter((path) => path !== keep);
  if (paths.length > 0) {
    const { error: removeError } = await bucket.remove(paths);
    if (removeError) throw removeError;
  }
}

// Comprueba la contraseña actual iniciando una sesión de prueba, que se cierra enseguida (RF-07.1).
export async function verifyCurrentPassword(email: string, password: string) {
  const { data, error } = await createPublicClient().auth.signInWithPassword({ email, password });
  if (error && isRateLimited(error)) throw new AppError('TOO_MANY_REQUESTS');
  if (error || !data.session) throw new AppError('INVALID_CURRENT_PASSWORD');
  await supabaseAdmin.auth.admin.signOut(data.session.access_token, 'local');
}

// RF-04.5
export const getMe: RequestHandler = (req, res) => {
  const { profile, email } = authOf(req);
  res.json(profile.toMe(email));
};

// RF-06.1 a RF-06.3
export const updateMe: RequestHandler = async (req, res) => {
  const { profile, email } = authOf(req);
  const changes = req.body as UpdateMeBody;

  const changesUsername = changes.username !== undefined && changes.username !== profile.username;
  if (changesUsername && profile.channel?.status !== 'offline') throw new AppError('CHANNEL_LIVE');

  // Un username repetido llega como UniqueConstraintError → USERNAME_TAKEN.
  await profile.update(changes);
  res.json(profile.toMe(email));
};

// RF-06.4, RF-06.5
export const uploadAvatar: RequestHandler = async (req, res) => {
  const { profile, email } = authOf(req);
  const file = req.file;
  const format = file && AVATAR_FORMATS[file.mimetype as keyof typeof AVATAR_FORMATS];
  if (!file || !format || !format.matches(file.buffer)) throw new AppError('INVALID_FILE');

  // Nombre nuevo en cada subida para que el navegador no muestre la imagen vieja desde caché.
  const path = `${profile.id}/${Date.now()}.${format.ext}`;
  const bucket = supabaseAdmin.storage.from(AVATARS_BUCKET);
  const { error } = await bucket.upload(path, file.buffer, { contentType: file.mimetype, cacheControl: '31536000' });
  if (error) throw error;

  await profile.update({ avatarUrl: bucket.getPublicUrl(path).data.publicUrl });
  await removeAvatars(profile.id, path);

  res.json(profile.toMe(email));
};

// RF-07
export const changePassword: RequestHandler = async (req, res) => {
  const { userId, email } = authOf(req);
  const { currentPassword, newPassword } = req.body as ChangePasswordBody;
  if (currentPassword === newPassword) throw new AppError('SAME_PASSWORD');

  await verifyCurrentPassword(email, currentPassword);

  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) throw fromAuthError(error);

  res.status(204).end();
};
