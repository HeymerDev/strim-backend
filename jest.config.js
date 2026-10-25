// Pruebas unitarias del backend: Jest + ts-jest, sin red ni base de datos.
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // src/ también es raíz para que la cobertura incluya los archivos que ninguna prueba importa.
  roots: ['<rootDir>/test', '<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  // Variables de entorno falsas antes de importar src/config/env.ts.
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  transform: {
    // 151002: aviso de ts-jest por "module": "Node16"; en Jest compila a CommonJS igual que tsc.
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json', diagnostics: { ignoreCodes: [151002] } }],
  },
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/server.ts', '!src/database/migrate.ts', '!src/database/migrations/**'],
};
