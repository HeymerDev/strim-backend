import { randomBytes, timingSafeEqual } from 'node:crypto';

// 24 bytes en base64url: 32 caracteres, 192 bits (RF-09.1).
export const generateStreamKey = () => randomBytes(24).toString('base64url');

// Comparación en tiempo constante para no filtrar la clave por tiempos de respuesta.
export function streamKeysMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
