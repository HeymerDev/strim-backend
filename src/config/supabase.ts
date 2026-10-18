import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// Sin sesión persistente: el servidor nunca guarda tokens entre peticiones.
const serverAuth = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

// Cliente admin (secret key): verificar tokens, administrar usuarios y Storage.
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, serverAuth);

// Cliente público (publishable key), uno por petición: guarda la sesión del usuario en memoria
// y compartirlo mezclaría usuarios.
export const createPublicClient = () => createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, serverAuth);

export const AVATARS_BUCKET = 'avatars';
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Crea el bucket público de avatares si todavía no existe (RF-06.4).
export async function ensureAvatarsBucket() {
  const { data: buckets, error } = await supabaseAdmin.storage.listBuckets();
  if (error) throw error;
  if (buckets.some((bucket) => bucket.id === AVATARS_BUCKET)) return;

  const { error: createError } = await supabaseAdmin.storage.createBucket(AVATARS_BUCKET, {
    public: true,
    fileSizeLimit: AVATAR_MAX_BYTES,
    allowedMimeTypes: AVATAR_MIME_TYPES,
  });
  if (createError) throw createError;
  console.log(`Bucket "${AVATARS_BUCKET}" creado en Supabase Storage.`);
}
