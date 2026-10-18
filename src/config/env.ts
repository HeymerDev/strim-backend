import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  FRONTEND_URL: z.url({ error: 'debe ser una URL válida' }).transform(withoutTrailingSlash),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'debe ser una URL postgresql://' }),

  SUPABASE_URL: z.url({ error: 'debe ser una URL válida' }).transform(withoutTrailingSlash),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1, 'no puede estar vacía'),
  SUPABASE_SECRET_KEY: z.string().min(1, 'no puede estar vacía'),

  MEDIAMTX_API_URL: z.url({ error: 'debe ser una URL válida' }).transform(withoutTrailingSlash),
  MEDIAMTX_SECRET: z.string().min(32, 'debe tener al menos 32 caracteres'),
  RTMP_PUBLIC_URL: z.url({ protocol: /^rtmps?$/, error: 'debe ser una URL rtmp://' }).transform(withoutTrailingSlash),
  HLS_PUBLIC_URL: z.url({ error: 'debe ser una URL válida' }).transform(withoutTrailingSlash),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((issue) => {
    const name = issue.path.join('.');
    const problem = process.env[name] === undefined ? 'falta' : issue.message;
    return `  - ${name}: ${problem}`;
  });
  console.error(`Configuración inválida en .env:\n${lines.join('\n')}\nRevisa .env.example.`);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
