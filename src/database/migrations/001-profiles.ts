import type { Migration } from './types';

export const profiles: Migration = {
  name: '001-profiles',

  async up(qi) {
    await qi.sequelize.query(`
      CREATE TABLE public.profiles (
        id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
        username varchar(20) NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,20}$'),
        display_name varchar(30) NOT NULL,
        bio varchar(200) NOT NULL DEFAULT '',
        avatar_url text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      -- Sin políticas: la API pública de Supabase no puede leerla (RNF-02).
      ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
      -- La tabla de control de migraciones también vive en public.
      ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
    `);
  },

  async down(qi) {
    await qi.sequelize.query('DROP TABLE public.profiles;');
  },
};
