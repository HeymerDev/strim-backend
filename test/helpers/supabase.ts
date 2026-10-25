// Dobles de los clientes de Supabase. En el archivo de pruebas:
//   jest.mock('../../../src/config/supabase', () => require('../../helpers/supabase').mockSupabaseModule());
// y en beforeEach: resetSupabase().
import { AuthError } from '@supabase/supabase-js';

// Bucket de Storage que devuelve supabaseAdmin.storage.from(...).
export const bucket = {
  upload: jest.fn(),
  getPublicUrl: jest.fn(),
  list: jest.fn(),
  remove: jest.fn(),
};

export const supabaseAdmin = {
  auth: {
    getClaims: jest.fn(),
    admin: {
      deleteUser: jest.fn(),
      signOut: jest.fn(),
      updateUserById: jest.fn(),
    },
  },
  storage: { from: jest.fn() },
};

// auth del cliente público que devuelve createPublicClient().
export const publicAuth = {
  signUp: jest.fn(),
  verifyOtp: jest.fn(),
  resend: jest.fn(),
  signInWithPassword: jest.fn(),
  refreshSession: jest.fn(),
  resetPasswordForEmail: jest.fn(),
};

export const createPublicClient = jest.fn();

// Módulo src/config/supabase con los clientes falsos y las constantes reales.
export function mockSupabaseModule() {
  return {
    ...jest.requireActual('../../src/config/supabase'),
    supabaseAdmin,
    createPublicClient,
  };
}

const allFakes = [
  ...Object.values(bucket),
  supabaseAdmin.auth.getClaims,
  ...Object.values(supabaseAdmin.auth.admin),
  supabaseAdmin.storage.from,
  ...Object.values(publicAuth),
  createPublicClient,
];

// Borra llamadas e implementaciones y deja respuestas exitosas por defecto.
export function resetSupabase() {
  for (const fake of allFakes) fake.mockReset();

  createPublicClient.mockReturnValue({ auth: publicAuth });
  supabaseAdmin.storage.from.mockReturnValue(bucket);
  supabaseAdmin.auth.admin.signOut.mockResolvedValue({ data: null, error: null });
  supabaseAdmin.auth.admin.deleteUser.mockResolvedValue({ data: { user: null }, error: null });
  supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({ data: { user: null }, error: null });

  bucket.upload.mockResolvedValue({ data: { path: '' }, error: null });
  bucket.getPublicUrl.mockImplementation((path: string) => ({
    data: { publicUrl: `https://storage.test/avatars/${path}` },
  }));
  bucket.list.mockResolvedValue({ data: [], error: null });
  bucket.remove.mockResolvedValue({ data: [], error: null });
}

// Error de Supabase Auth con su código y estado HTTP.
export const authError = (code: string, status = 400, message = `error ${code}`) => new AuthError(message, status, code);

// Sesión de Supabase como la devuelven signInWithPassword, verifyOtp o refreshSession.
export function fakeSession(user: { id: string; email?: string } = { id: 'user-1', email: 'ana@example.com' }) {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 3600,
    expires_at: 1_800_000_000,
    token_type: 'bearer',
    user,
  };
}
