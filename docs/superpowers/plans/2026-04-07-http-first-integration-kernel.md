# HTTP-First Integration Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first executable slice of the HTTP-first integration architecture by introducing a unified manifest/auth/execution kernel and wiring permission checks to execution-scoped auth.

**Architecture:** Add a new `integration-runtime` module inside `apps/api` with pure TypeScript core units for manifest mapping, authorization resolution, and execution orchestration. Reuse the existing `AdapterRuntimeService`, `AuthBindingService`, and connector model instead of replacing adapters, then route `PermissionService` through the new runtime so user-scoped auth is resolved consistently.

**Tech Stack:** NestJS, TypeScript, Jest, existing Prisma-backed connector/auth services

---

### Task 1: Add the Integration Runtime Core

**Files:**
- Create: `apps/api/src/modules/integration-runtime/types.ts`
- Create: `apps/api/src/modules/integration-runtime/legacy-connector-manifest.mapper.ts`
- Create: `apps/api/src/modules/integration-runtime/authorization-resolver.ts`
- Create: `apps/api/src/modules/integration-runtime/execution-kernel.ts`
- Test: `apps/api/src/modules/integration-runtime/legacy-connector-manifest.mapper.spec.ts`
- Test: `apps/api/src/modules/integration-runtime/authorization-resolver.spec.ts`
- Test: `apps/api/src/modules/integration-runtime/execution-kernel.spec.ts`

- [ ] **Step 1: Write the failing manifest mapper test**

```ts
import { LegacyConnectorManifestMapper } from './legacy-connector-manifest.mapper';

describe('LegacyConnectorManifestMapper', () => {
  it('maps delegated auth and hybrid routing into a single manifest', () => {
    const mapper = new LegacyConnectorManifestMapper();

    expect(mapper.mapConnector({
      id: 'connector-1',
      authType: 'oauth2',
      authConfig: {
        delegatedAuth: {
          enabled: true,
          provider: 'sso',
        },
        platformConfig: {
          ticketBrokerUrl: 'https://broker.example.com/tickets',
        },
      },
      capability: {
        supportsCancel: true,
        supportsRealtimePerm: true,
      },
      bootstrapMode: 'hybrid',
    } as any)).toEqual(expect.objectContaining({
      capabilities: expect.arrayContaining(['submit', 'queryStatus', 'cancel', 'permission.check']),
      authChoices: expect.arrayContaining([
        expect.objectContaining({ id: 'service', mode: 'service' }),
        expect.objectContaining({ id: 'delegated', mode: 'user' }),
      ]),
      routes: expect.objectContaining({
        submit: ['api', 'rpa'],
      }),
    }));
  });
});
```

- [ ] **Step 2: Run the mapper test to verify it fails**

Run: `corepack pnpm --dir apps/api test -- legacy-connector-manifest.mapper.spec.ts --runInBand`
Expected: FAIL because the mapper file does not exist yet.

- [ ] **Step 3: Write the failing authorization resolver test**

```ts
import { AuthorizationResolver } from './authorization-resolver';

describe('AuthorizationResolver', () => {
  it('returns requires_user_action when delegated auth is selected without a usable binding', async () => {
    const resolver = new AuthorizationResolver();

    await expect(resolver.resolve({
      manifest: {
        provider: 'mock',
        version: '1.0.0',
        targets: ['oa'],
        capabilities: ['submit'],
        authChoices: [
          { id: 'delegated', mode: 'user', artifact: 'bearer_token', interactive: true, callback: 'oauth2' },
        ],
        routes: { submit: ['api'] },
      },
      capability: 'submit',
      authChoiceId: 'delegated',
      artifactResolver: async () => null,
    })).resolves.toEqual(expect.objectContaining({
      state: 'requires_user_action',
      authChoice: expect.objectContaining({ id: 'delegated' }),
    }));
  });
});
```

- [ ] **Step 4: Run the authorization resolver test to verify it fails**

Run: `corepack pnpm --dir apps/api test -- authorization-resolver.spec.ts --runInBand`
Expected: FAIL because the resolver file does not exist yet.

- [ ] **Step 5: Write the failing execution kernel test**

```ts
import { ExecutionKernel } from './execution-kernel';

describe('ExecutionKernel', () => {
  it('executes through the selected provider and normalizes the result', async () => {
    const kernel = new ExecutionKernel();

    const result = await kernel.execute({
      manifest: {
        provider: 'mock',
        version: '1.0.0',
        targets: ['oa'],
        capabilities: ['queryStatus'],
        authChoices: [{ id: 'service', mode: 'service', artifact: 'bearer_token', interactive: false }],
        routes: { queryStatus: ['api'] },
      },
      capability: 'queryStatus',
      input: { submissionId: 'oa-1' },
      provider: {
        resolveArtifact: async () => ({ type: 'bearer_token', payloadRef: 'inline', payload: { accessToken: 'token' } }),
        execute: async () => ({ status: 'approved' }),
        normalize: async (raw) => ({ status: 'succeeded', data: raw }),
      } as any,
    });

    expect(result).toEqual({
      status: 'succeeded',
      data: { status: 'approved' },
    });
  });
});
```

- [ ] **Step 6: Run the execution kernel test to verify it fails**

Run: `corepack pnpm --dir apps/api test -- execution-kernel.spec.ts --runInBand`
Expected: FAIL because the kernel file does not exist yet.

- [ ] **Step 7: Implement the minimal core units**

```ts
export class AuthorizationResolver {
  async resolve(input: ResolveAuthorizationInput): Promise<AuthorizationResolution> {
    const authChoice = this.selectAuthChoice(input.manifest, input.capability, input.authChoiceId);
    const artifact = await input.artifactResolver(authChoice);
    if (!artifact) {
      return {
        state: authChoice.interactive ? 'requires_user_action' : 'not_configured',
        authChoice,
      };
    }

    return {
      state: 'ready',
      authChoice,
      artifact,
    };
  }
}
```

- [ ] **Step 8: Run the three core tests to verify they pass**

Run: `corepack pnpm --dir apps/api test -- legacy-connector-manifest.mapper.spec.ts authorization-resolver.spec.ts execution-kernel.spec.ts --runInBand`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/integration-runtime docs/superpowers/plans/2026-04-07-http-first-integration-kernel.md
git commit -m "feat: add integration runtime core"
```

### Task 2: Wrap Existing Adapters as a Provider

**Files:**
- Create: `apps/api/src/modules/integration-runtime/existing-adapter-provider.ts`
- Create: `apps/api/src/modules/integration-runtime/integration-runtime.service.ts`
- Create: `apps/api/src/modules/integration-runtime/integration-runtime.module.ts`
- Create: `apps/api/src/modules/integration-runtime/existing-adapter-provider.spec.ts`
- Modify: `apps/api/src/modules/adapter-runtime/adapter-runtime.module.ts`

- [ ] **Step 1: Write the failing provider test**

```ts
import { ExistingAdapterProvider } from './existing-adapter-provider';

describe('ExistingAdapterProvider', () => {
  it('uses execution-scoped auth when resolving a user artifact', async () => {
    const adapterRuntimeService = {
      resolveAuthConfigForExecution: jest.fn().mockResolvedValue({ accessToken: 'user-token' }),
    };

    const provider = new ExistingAdapterProvider(adapterRuntimeService as any, {} as any);

    await expect(provider.resolveArtifact({
      connector: { id: 'connector-1', authType: 'oauth2', authConfig: {} },
      authChoice: { id: 'delegated', mode: 'user', artifact: 'bearer_token', interactive: true },
      authScope: { tenantId: 'tenant-1', userId: 'user-1' },
    })).resolves.toEqual(expect.objectContaining({
      type: 'bearer_token',
      payload: expect.objectContaining({ accessToken: 'user-token' }),
    }));
  });
});
```

- [ ] **Step 2: Run the provider test to verify it fails**

Run: `corepack pnpm --dir apps/api test -- existing-adapter-provider.spec.ts --runInBand`
Expected: FAIL because the provider file does not exist yet.

- [ ] **Step 3: Implement the provider and runtime service**

```ts
export class IntegrationRuntimeService {
  constructor(
    private readonly adapterRuntimeService: AdapterRuntimeService,
    private readonly authBindingService: AuthBindingService,
  ) {}

  async resolveConnectorExecutionAuth(input: ResolveConnectorExecutionAuthInput) {
    const manifest = this.mapper.mapConnector(input.connector);
    return this.authorizationResolver.resolve({
      manifest,
      capability: input.capability,
      authChoiceId: input.authChoiceId,
      artifactResolver: (authChoice) => this.provider.resolveArtifact({
        connector: input.connector,
        authChoice,
        authScope: input.authScope,
      }),
    });
  }
}
```

- [ ] **Step 4: Run the provider test to verify it passes**

Run: `corepack pnpm --dir apps/api test -- existing-adapter-provider.spec.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/integration-runtime apps/api/src/modules/adapter-runtime/adapter-runtime.module.ts
git commit -m "feat: add existing adapter provider runtime"
```

### Task 3: Route Permission Checks Through the Integration Runtime

**Files:**
- Modify: `apps/api/src/modules/permission/permission.service.ts`
- Modify: `apps/api/src/modules/permission/permission.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/modules/permission/permission.service.spec.ts`

- [ ] **Step 1: Write the failing permission test**

```ts
it('uses execution-scoped auth when performing OA permission checks', async () => {
  integrationRuntimeService.resolveConnectorExecutionAuth.mockResolvedValue({
    state: 'ready',
    artifact: {
      payload: {
        headerName: 'x-token',
        token: 'user-scoped-token',
      },
    },
  });

  await service.check({
    tenantId: 'tenant-1',
    userId: 'user-1',
    processCode: 'travel_expense',
    action: 'submit',
    traceId: 'trace-2',
  });

  expect(integrationRuntimeService.resolveConnectorExecutionAuth).toHaveBeenCalledWith(
    expect.objectContaining({
      capability: 'permission.check',
      authScope: { tenantId: 'tenant-1', userId: 'user-1' },
    }),
  );
});
```

- [ ] **Step 2: Run the permission test to verify it fails**

Run: `corepack pnpm --dir apps/api test -- permission.service.spec.ts --runInBand`
Expected: FAIL because `PermissionService` does not inject or use `IntegrationRuntimeService`.

- [ ] **Step 3: Implement the permission integration**

```ts
const authResolution = await this.integrationRuntimeService.resolveConnectorExecutionAuth({
  connector,
  capability: 'permission.check',
  authScope: {
    tenantId: input.tenantId,
    userId: input.userId,
  },
});

const resolvedAuthConfig = authResolution.artifact?.payload || {};
```

- [ ] **Step 4: Run the permission test to verify it passes**

Run: `corepack pnpm --dir apps/api test -- permission.service.spec.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Run the focused verification suite**

Run: `corepack pnpm --dir apps/api test -- integration-runtime permission.service.spec.ts adapter-runtime.service.spec.ts --runInBand`
Expected: PASS with 0 failures

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/permission apps/api/src/app.module.ts
git commit -m "feat: route permission checks through integration runtime"
```
