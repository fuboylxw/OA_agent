module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.test.ts',
  ],
  moduleNameMapper: {
    '^@uniflow/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
    '^@uniflow/shared-schema$': '<rootDir>/../../packages/shared-schema/src/index.ts',
    '^@uniflow/agent-kernel$': '<rootDir>/../../packages/agent-kernel/src/index.ts',
    '^@uniflow/oa-adapters$': '<rootDir>/../../packages/oa-adapters/src/index.ts',
    '^@uniflow/compat-engine$': '<rootDir>/../../packages/compat-engine/src/index.ts',
  },
};
