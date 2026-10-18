import 'reflect-metadata';
import http from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { ensureAvatarsBucket } from './config/supabase';
import { closeDatabase, connectDatabase } from './database';

// Nombra el paso que falló al arrancar, para saber qué revisar en el .env.
async function step(label: string, run: () => Promise<void>) {
  try {
    await run();
  } catch (err) {
    throw new Error(`${label}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

async function main() {
  await step('Conexión a la base de datos (DATABASE_URL)', connectDatabase);
  await step('Bucket de avatares en Supabase Storage (SUPABASE_URL / SUPABASE_SECRET_KEY)', ensureAvatarsBucket);

  const server = http.createServer(createApp());
  server.listen(env.PORT, () => {
    console.log(`Strim API escuchando en http://localhost:${env.PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} recibido, cerrando…`);
    server.close(() => {
      closeDatabase().finally(() => process.exit(0));
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('No se pudo iniciar el servidor:', err);
  process.exit(1);
});
