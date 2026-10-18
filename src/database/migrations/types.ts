import type { QueryInterface } from 'sequelize';

export type Migration = {
  name: string;
  up: (qi: QueryInterface) => Promise<void>;
  down: (qi: QueryInterface) => Promise<void>;
};
