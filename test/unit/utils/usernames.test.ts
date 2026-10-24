import { isReservedUsername, USERNAME_PATTERN } from '../../../src/utils/usernames';

describe('USERNAME_PATTERN', () => {
  it.each(['ana', 'ana_01', '___', 'a'.repeat(20), '123'])('acepta "%s"', (username) => {
    expect(USERNAME_PATTERN.test(username)).toBe(true);
  });

  it.each([
    ['ab', 'menos de 3 caracteres'],
    ['a'.repeat(21), 'más de 20 caracteres'],
    ['Ana', 'mayúsculas'],
    ['ana-01', 'guion'],
    ['ana.01', 'punto'],
    ['ana 01', 'espacio'],
    ['niño', 'letras fuera de a-z'],
    ['', 'vacío'],
  ])('rechaza "%s" (%s)', (username) => {
    expect(USERNAME_PATTERN.test(username)).toBe(false);
  });
});

describe('isReservedUsername', () => {
  it.each([
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
  ])('"%s" está reservado', (username) => {
    expect(isReservedUsername(username)).toBe(true);
  });

  it('no distingue mayúsculas', () => {
    expect(isReservedUsername('ADMIN')).toBe(true);
    expect(isReservedUsername('Live')).toBe(true);
    expect(isReservedUsername('StRiM')).toBe(true);
  });

  it('un username normal no está reservado', () => {
    expect(isReservedUsername('ana')).toBe(false);
    expect(isReservedUsername('admin2')).toBe(false);
    expect(isReservedUsername('livestream')).toBe(false);
  });
});
