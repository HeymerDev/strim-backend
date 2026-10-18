import { z } from 'zod';
import { isReservedUsername, USERNAME_PATTERN } from '../utils/usernames';

// Mensajes de zod en español para los errores que no tienen uno propio.
z.config(z.locales.es());

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'El correo es demasiado largo.')
  .pipe(z.email('Correo inválido.'));

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_PATTERN, 'De 3 a 20 caracteres: letras, números o guion bajo.')
  .refine((username) => !isReservedUsername(username), 'Ese nombre de usuario no está disponible.');

// Política de contraseñas (RNF-04).
export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres.')
  .max(72, 'La contraseña puede tener como máximo 72 caracteres.')
  .regex(/\p{L}/u, 'La contraseña debe tener al menos una letra.')
  .regex(/\d/, 'La contraseña debe tener al menos un número.');

// Para comprobar una contraseña existente no se aplica la política, solo que no esté vacía.
export const anyPasswordSchema = z.string().min(1, 'Escribe tu contraseña.').max(72);

// Supabase permite códigos de 6 a 10 dígitos según "Email OTP Length" (Strim usa 6).
export const otpSchema = z.string().trim().regex(/^\d{6,10}$/, 'El código debe tener solo números (6 a 10 dígitos).');
