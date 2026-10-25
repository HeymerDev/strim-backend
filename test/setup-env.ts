// Se ejecuta antes de cada archivo de pruebas (setupFiles de jest.config.js).
import 'reflect-metadata';

// Valores falsos pero válidos para todas las variables: si src/config/env.ts no las
// encuentra, hace process.exit(1). Se asignan antes de importar cualquier código de src/,
// y dotenv no pisa variables que ya existen, así que el .env real no se usa.
Object.assign(process.env, {
  // También apaga los logs de morgan.
  NODE_ENV: 'test',
  PORT: '4000',
  FRONTEND_URL: 'http://localhost:5173',
  // Local: sin SSL. Nunca se conecta.
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/strim_test',
  SUPABASE_URL: 'http://127.0.0.1:9',
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
  SUPABASE_SECRET_KEY: 'test-secret',
  MEDIAMTX_API_URL: 'http://127.0.0.1:9997',
  MEDIAMTX_SECRET: 'secreto-de-pruebas-de-32-caracteres-o-mas',
  RTMP_PUBLIC_URL: 'rtmp://localhost:1935/live',
  HLS_PUBLIC_URL: 'http://localhost:8888',
});
