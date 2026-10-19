import { z } from 'zod';
import { anyPasswordSchema, passwordSchema, usernameSchema } from './common';

export const updateMeBody = z
  .object({
    username: usernameSchema.optional(),
    displayName: z.string().trim().min(1, 'El nombre visible no puede estar vacío.').max(30).optional(),
    bio: z.string().trim().max(200).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), 'No hay nada que actualizar.');

export const changePasswordBody = z.object({
  currentPassword: anyPasswordSchema,
  newPassword: passwordSchema,
});

export const deleteMeBody = z.object({ password: anyPasswordSchema });

export type UpdateMeBody = z.infer<typeof updateMeBody>;
export type DeleteMeBody = z.infer<typeof deleteMeBody>;
export type ChangePasswordBody = z.infer<typeof changePasswordBody>;
