export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

// Palabras que chocan con rutas del frontend o de la API (diseño §6).
const RESERVED_USERNAMES = new Set([
  'admin',
  'api',
  'auth',
  'dashboard',
  'help',
  'internal',
  'live',
  'login',
  'logout',
  'me',
  'register',
  'reset',
  'settings',
  'signup',
  'stream',
  'strim',
  'support',
  'verify',
]);

export const isReservedUsername = (username: string) => RESERVED_USERNAMES.has(username.toLowerCase());
