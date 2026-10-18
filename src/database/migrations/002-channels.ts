import type { Migration } from './types';

export const channels: Migration = {
  name: '002-channels',

  async up(qi) {
    await qi.sequelize.query(`
      CREATE TYPE public.channel_status AS ENUM ('offline', 'waiting', 'live');

      CREATE TABLE public.channels (
        user_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
        stream_key varchar(64) NOT NULL UNIQUE,
        status public.channel_status NOT NULL DEFAULT 'offline',
        title varchar(100) NOT NULL DEFAULT '',
        live_started_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
    `);
  },

  async down(qi) {
    await qi.sequelize.query(`
      DROP TABLE public.channels;
      DROP TYPE public.channel_status;
    `);
  },
};
