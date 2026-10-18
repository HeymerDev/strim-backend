import 'reflect-metadata';
import type { QueryInterface } from 'sequelize';
import { SequelizeStorage, Umzug } from 'umzug';
import { sequelize } from './index';
import { migrations } from './migrations';

const umzug = new Umzug<QueryInterface>({
  migrations: migrations.map((migration) => ({
    name: migration.name,
    up: ({ context }) => migration.up(context),
    down: ({ context }) => migration.down(context),
  })),
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize, tableName: 'schema_migrations' }),
  logger: console,
});

async function main() {
  const command = process.argv[2];
  if (command === 'up') {
    const done = await umzug.up();
    console.log(done.length ? `Aplicadas: ${done.map((m) => m.name).join(', ')}` : 'No hay migraciones pendientes.');
  } else if (command === 'down') {
    const undone = await umzug.down();
    console.log(undone.length ? `Revertida: ${undone[0].name}` : 'No hay migraciones para revertir.');
  } else {
    console.error('Uso: tsx src/database/migrate.ts <up|down>');
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('La migración falló:', err);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
