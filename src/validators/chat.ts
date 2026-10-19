import { z } from 'zod';

export const joinPayload = z.object({
  username: z.string().trim().toLowerCase().min(1).max(20),
});

// RF-15.3: texto plano de 1 a 300 caracteres sin los espacios de los extremos.
export const sendPayload = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'El mensaje no puede estar vacío.')
    .max(300, 'El mensaje puede tener como máximo 300 caracteres.'),
});
