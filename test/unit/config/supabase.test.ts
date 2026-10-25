// createClient falso: cada llamada devuelve un cliente nuevo con solo los métodos de Storage
// que usa ensureAvatarsBucket. Así no se crea ningún cliente real ni se toca la red.
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ storage: { listBuckets: jest.fn(), createBucket: jest.fn() } })),
}));

import { createClient } from '@supabase/supabase-js';
import { env } from '../../../src/config/env';
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  AVATARS_BUCKET,
  createPublicClient,
  ensureAvatarsBucket,
  supabaseAdmin,
} from '../../../src/config/supabase';

type ListBucketsResult = Awaited<ReturnType<typeof supabaseAdmin.storage.listBuckets>>;
type CreateBucketResult = Awaited<ReturnType<typeof supabaseAdmin.storage.createBucket>>;

const listBuckets = jest.mocked(supabaseAdmin.storage.listBuckets);
const createBucket = jest.mocked(supabaseAdmin.storage.createBucket);

// Opciones de los dos clientes: sin sesión persistente en el servidor.
const serverAuth = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

// Respuesta de listBuckets con los buckets de esos ids.
const bucketsFound = (...ids: string[]) =>
  ({ data: ids.map((id) => ({ id, name: id, public: true })), error: null }) as unknown as ListBucketsResult;

const storageError = (message: string) => Object.assign(new Error(message), { name: 'StorageApiError', status: 500 });

let consoleLog: jest.SpyInstance;

beforeEach(() => {
  listBuckets.mockReset().mockResolvedValue(bucketsFound());
  createBucket
    .mockReset()
    .mockResolvedValue({ data: { name: AVATARS_BUCKET }, error: null } as unknown as CreateBucketResult);
  consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('constantes de avatares', () => {
  it('bucket "avatars", hasta 2 MB, JPG/PNG/WebP', () => {
    expect(AVATARS_BUCKET).toBe('avatars');
    expect(AVATAR_MAX_BYTES).toBe(2_097_152);
    expect(AVATAR_MIME_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });
});

describe('clientes de Supabase', () => {
  it('supabaseAdmin se crea con la secret key y sin sesión persistente', () => {
    // Se carga el módulo de nuevo para ver la llamada que hace al importarse.
    let isolatedCreateClient!: jest.Mock;
    jest.isolateModules(() => {
      isolatedCreateClient = require('@supabase/supabase-js').createClient;
      require('../../../src/config/supabase');
    });

    expect(isolatedCreateClient).toHaveBeenCalledTimes(1);
    expect(isolatedCreateClient).toHaveBeenCalledWith(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, serverAuth);
  });

  it('createPublicClient() crea un cliente nuevo en cada llamada, con la publishable key', () => {
    const first = createPublicClient();
    const second = createPublicClient();

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(createClient).toHaveBeenNthCalledWith(1, env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, serverAuth);
    expect(createClient).toHaveBeenNthCalledWith(2, env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, serverAuth);
    expect(first).not.toBe(second);
    expect(first).not.toBe(supabaseAdmin);
  });
});

describe('ensureAvatarsBucket', () => {
  it('si el bucket ya existe no llama a createBucket ni escribe el log', async () => {
    listBuckets.mockResolvedValue(bucketsFound('otro', 'avatars'));

    await expect(ensureAvatarsBucket()).resolves.toBeUndefined();

    expect(listBuckets).toHaveBeenCalledTimes(1);
    expect(createBucket).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it.each([
    ['no hay ningún bucket', []],
    ['solo hay otros buckets', ['otro', 'avatars-viejo']],
  ])('si %s, lo crea público, de hasta 2 MB y con los tres tipos de imagen', async (_caso, ids) => {
    listBuckets.mockResolvedValue(bucketsFound(...ids));

    await expect(ensureAvatarsBucket()).resolves.toBeUndefined();

    expect(createBucket).toHaveBeenCalledTimes(1);
    expect(createBucket).toHaveBeenCalledWith('avatars', {
      public: true,
      fileSizeLimit: 2 * 1024 * 1024,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    });
    expect(consoleLog).toHaveBeenCalledWith('Bucket "avatars" creado en Supabase Storage.');
  });

  it('si listBuckets devuelve error, lo lanza sin intentar crear el bucket', async () => {
    const error = storageError('No se pudo listar');
    listBuckets.mockResolvedValue({ data: null, error } as unknown as ListBucketsResult);

    await expect(ensureAvatarsBucket()).rejects.toBe(error);

    expect(createBucket).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it('si createBucket devuelve error, lo lanza y no escribe el log', async () => {
    const error = storageError('No se pudo crear');
    createBucket.mockResolvedValue({ data: null, error } as unknown as CreateBucketResult);

    await expect(ensureAvatarsBucket()).rejects.toBe(error);

    expect(createBucket).toHaveBeenCalledTimes(1);
    expect(consoleLog).not.toHaveBeenCalled();
  });
});
