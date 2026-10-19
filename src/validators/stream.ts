import { z } from 'zod';

const titleSchema = z.string().trim().max(100, 'El título puede tener como máximo 100 caracteres.');

export const startStreamBody = z.object({ title: titleSchema.optional() });
export const updateStreamBody = z.object({ title: titleSchema });

export type StartStreamBody = z.infer<typeof startStreamBody>;
export type UpdateStreamBody = z.infer<typeof updateStreamBody>;
