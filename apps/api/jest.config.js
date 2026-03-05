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
    '^@uniflow/shared-types$': '<rootDir>/../../packages/shared-types/src',
    '^@uniflow/shared-schema$': '<rootDir>/../../packages/shared-schema/src',
    '^@uniflow/agent-kernel$': '<rootDir>/../../packages/agent-kernel/src',
    '^@uniflow/oa-adapters$': '<rootDir>/../../packages/oa-adapters/src',
    '^@uniflow/compat-engine$': '<rootDir>/../../packages/compat-engine/src',
  },
};
