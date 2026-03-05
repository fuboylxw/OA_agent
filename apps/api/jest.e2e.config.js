module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.e2e-spec.ts', '**/*.spec.ts'],
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
    '^@uniflow/shared-types$': '<rootDir>/../../packages/shared-types/src',
    '^@uniflow/shared-schema$': '<rootDir>/../../packages/shared-schema/src',
    '^@uniflow/agent-kernel$': '<rootDir>/../../packages/agent-kernel/src',
    '^@uniflow/oa-adapters$': '<rootDir>/../../packages/oa-adapters/src',
    '^@uniflow/compat-engine$': '<rootDir>/../../packages/compat-engine/src',
  },
  testTimeout: 30000,
};
