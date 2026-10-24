import type { ZodType } from 'zod';
import {
  anyPasswordSchema,
  emailSchema,
  otpSchema,
  passwordSchema,
  usernameSchema,
} from '../../../src/validators/common';

// Primer mensaje de error, o null si el valor es válido.
function errorOf(schema: ZodType, value: unknown): string | null {
  const result = schema.safeParse(value);
  return result.success ? null : result.error.issues[0].message;
}

describe('emailSchema', () => {
  it('quita los espacios y pasa a minúsculas', () => {
    expect(emailSchema.parse('  Ana.Perez@Example.COM  ')).toBe('ana.perez@example.com');
  });

  it.each(['no-es-correo', 'ana@', '@example.com', 'ana perez@example.com', ''])('rechaza "%s"', (value) => {
    expect(errorOf(emailSchema, value)).toBe('Correo inválido.');
  });

  it('rechaza un correo de más de 254 caracteres', () => {
    const long = `${'a'.repeat(250)}@example.com`;

    expect(errorOf(emailSchema, long)).toBe('El correo es demasiado largo.');
  });

  it('rechaza algo que no es texto', () => {
    expect(emailSchema.safeParse(123).success).toBe(false);
  });
});

describe('usernameSchema', () => {
  it('quita los espacios y pasa a minúsculas', () => {
    expect(usernameSchema.parse('  Ana_01 ')).toBe('ana_01');
  });

  it('acepta de 3 a 20 caracteres', () => {
    expect(usernameSchema.parse('abc')).toBe('abc');
    expect(usernameSchema.parse('a'.repeat(20))).toBe('a'.repeat(20));
  });

  it.each([
    ['ab', 'menos de 3'],
    ['a'.repeat(21), 'más de 20'],
    ['ana-01', 'guion'],
    ['ana perez', 'espacio interno'],
    ['niño', 'ñ'],
  ])('rechaza "%s" (%s)', (value) => {
    expect(errorOf(usernameSchema, value)).toBe('De 3 a 20 caracteres: letras, números o guion bajo.');
  });

  it.each(['admin', 'ADMIN', ' Live ', 'Strim'])('rechaza el reservado "%s"', (value) => {
    expect(errorOf(usernameSchema, value)).toBe('Ese nombre de usuario no está disponible.');
  });
});

describe('passwordSchema', () => {
  it('acepta 8 caracteres con letra y número', () => {
    expect(passwordSchema.parse('abcdefg1')).toBe('abcdefg1');
  });

  it('acepta hasta 72 caracteres', () => {
    const password = `${'a'.repeat(71)}1`;

    expect(passwordSchema.parse(password)).toBe(password);
  });

  it('acepta letras con tilde o ñ como letra', () => {
    expect(passwordSchema.safeParse('ñññññññ1').success).toBe(true);
  });

  it('rechaza menos de 8 caracteres', () => {
    expect(errorOf(passwordSchema, 'abcdef1')).toBe('La contraseña debe tener al menos 8 caracteres.');
  });

  it('rechaza más de 72 caracteres', () => {
    expect(errorOf(passwordSchema, `${'a'.repeat(72)}1`)).toBe('La contraseña puede tener como máximo 72 caracteres.');
  });

  it('rechaza una contraseña sin letras', () => {
    expect(errorOf(passwordSchema, '12345678')).toBe('La contraseña debe tener al menos una letra.');
  });

  it('rechaza una contraseña sin números', () => {
    expect(errorOf(passwordSchema, 'abcdefgh')).toBe('La contraseña debe tener al menos un número.');
  });
});

describe('anyPasswordSchema', () => {
  it('acepta cualquier contraseña no vacía, sin aplicar la política', () => {
    expect(anyPasswordSchema.parse('x')).toBe('x');
  });

  it('rechaza una contraseña vacía', () => {
    expect(errorOf(anyPasswordSchema, '')).toBe('Escribe tu contraseña.');
  });

  it('rechaza más de 72 caracteres', () => {
    expect(anyPasswordSchema.safeParse('a'.repeat(73)).success).toBe(false);
  });
});

describe('otpSchema', () => {
  it.each(['123456', '1234567', '1234567890'])('acepta "%s" (6 a 10 dígitos)', (value) => {
    expect(otpSchema.parse(value)).toBe(value);
  });

  it('quita los espacios de los extremos', () => {
    expect(otpSchema.parse(' 123456 ')).toBe('123456');
  });

  it.each(['12345', '12345678901', '12a456', '123 456', ''])('rechaza "%s"', (value) => {
    expect(errorOf(otpSchema, value)).toBe('El código debe tener solo números (6 a 10 dígitos).');
  });
});
