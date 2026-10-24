import { generateStreamKey, safeEqual } from '../../../src/utils/streamKey';

describe('generateStreamKey', () => {
  it('genera 32 caracteres base64url', () => {
    expect(generateStreamKey()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('genera una clave distinta cada vez', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateStreamKey()));

    expect(keys.size).toBe(200);
  });
});

describe('safeEqual', () => {
  it('devuelve true si los textos son iguales', () => {
    expect(safeEqual('clave-secreta', 'clave-secreta')).toBe(true);
  });

  it('devuelve false si tienen el mismo largo pero distinto contenido', () => {
    expect(safeEqual('clave-secreta', 'clave-secretx')).toBe(false);
  });

  it('devuelve false (sin lanzar) si tienen distinto largo', () => {
    expect(() => safeEqual('clave-secreta', 'clave')).not.toThrow();
    expect(safeEqual('clave-secreta', 'clave')).toBe(false);
    expect(safeEqual('clave', 'clave-secreta')).toBe(false);
  });

  it('compara bytes: un carácter multibyte cambia el largo', () => {
    expect(safeEqual('nino', 'niño')).toBe(false);
  });

  it('devuelve false con un texto vacío frente a uno no vacío', () => {
    expect(safeEqual('clave', '')).toBe(false);
  });
});
