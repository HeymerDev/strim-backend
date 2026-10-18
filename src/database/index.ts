import { Sequelize } from 'sequelize-typescript';
import { env } from '../config/env';
import { AuthUser, Channel, ChatMessage, Profile } from '../models';

// Supabase exige SSL. Una base local (por ejemplo, en Docker) no lo usa.
const host = new URL(env.DATABASE_URL).hostname;
const isLocalDatabase = host === 'localhost' || host === '127.0.0.1';

export const sequelize = new Sequelize(env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: isLocalDatabase ? {} : { ssl: { require: true, rejectUnauthorized: false } },
  define: { underscored: true },
  logging: false,
  pool: { max: 5 },
  models: [Profile, Channel, ChatMessage, AuthUser],
});

export async function connectDatabase() {
  await sequelize.authenticate();
}

export async function closeDatabase() {
  await sequelize.close();
}
