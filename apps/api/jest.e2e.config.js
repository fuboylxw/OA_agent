module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.e2e-spec.ts', '**/e2e.spec.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.e2e-spec.ts',
  ],
  moduleNameMapper: {
    '^@uniflow/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
    '^@uniflow/shared-schema$': '<rootDir>/../../packages/shared-schema/src/index.ts',
    '^@uniflow/agent-kernel$': '<rootDir>/../../packages/agent-kernel/src/index.ts',
    '^@uniflow/oa-adapters$': '<rootDir>/../../packages/oa-adapters/src/index.ts',
    '^@uniflow/compat-engine$': '<rootDir>/../../packages/compat-engine/src/index.ts',
  },
  testTimeout: 30000,
};
