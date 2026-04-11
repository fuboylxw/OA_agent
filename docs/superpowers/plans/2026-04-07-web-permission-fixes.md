# Web Permission Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent regular users from seeing or entering admin-only frontend areas involved in the latest browser validation.

**Architecture:** Add a small shared access-control helper in `apps/web` that centralizes role checks for route protection and home quick actions. Keep page behavior unchanged for admins while removing the misleading home entry and applying the missing guard on `/api-upload`.

**Tech Stack:** Next.js 14, React 18, TypeScript, Jest with `ts-jest`

---

### Task 1: Add access-control regression tests

**Files:**
- Create: `apps/web/jest.config.js`
- Create: `apps/web/src/app/lib/access-control.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { getHomeQuickActionHrefs, isRouteAllowed } from './access-control';

describe('access control', () => {
  it('hides bootstrap quick action from regular users', () => {
    expect(getHomeQuickActionHrefs(['user'])).not.toContain('/bootstrap');
  });

  it('keeps bootstrap quick action for admins', () => {
    expect(getHomeQuickActionHrefs(['admin'])).toContain('/bootstrap');
  });

  it('blocks api-upload for regular users', () => {
    expect(isRouteAllowed('/api-upload', ['user'])).toBe(false);
  });

  it('allows api-upload for admins and flow managers', () => {
    expect(isRouteAllowed('/api-upload', ['admin'])).toBe(true);
    expect(isRouteAllowed('/api-upload', ['flow_manager'])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --dir apps/web exec jest src/app/lib/access-control.test.ts --runInBand`
Expected: FAIL because `./access-control` does not exist yet.

- [ ] **Step 3: Add minimal Jest config for the web app**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/jest.config.js apps/web/src/app/lib/access-control.test.ts
git commit -m "test: add web access control regression coverage"
```

### Task 2: Implement shared access-control helpers

**Files:**
- Create: `apps/web/src/app/lib/access-control.ts`

- [ ] **Step 1: Write minimal implementation**

```ts
const HOME_QUICK_ACTIONS = [
  { href: '/chat' },
  { href: '/submissions' },
  { href: '/processes' },
  { href: '/bootstrap', roles: ['admin'] },
] as const;

const ROUTE_ROLE_RULES: Array<{ path: string; roles?: string[] }> = [
  { path: '/bootstrap', roles: ['admin'] },
  { path: '/connectors', roles: ['admin', 'flow_manager'] },
  { path: '/api-upload', roles: ['admin', 'flow_manager'] },
];

export function hasRequiredRole(userRoles: string[], allowedRoles?: string[]) {
  if (!allowedRoles || allowedRoles.length === 0) return true;
  return allowedRoles.some((role) => userRoles.includes(role));
}

export function getHomeQuickActionHrefs(userRoles: string[]) {
  return HOME_QUICK_ACTIONS
    .filter((item) => hasRequiredRole(userRoles, item.roles as string[] | undefined))
    .map((item) => item.href);
}

export function isRouteAllowed(pathname: string, userRoles: string[]) {
  const match = ROUTE_ROLE_RULES.find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));
  return hasRequiredRole(userRoles, match?.roles);
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `corepack pnpm --dir apps/web exec jest src/app/lib/access-control.test.ts --runInBand`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/lib/access-control.ts apps/web/src/app/lib/access-control.test.ts
git commit -m "feat: add shared web access control helpers"
```

### Task 3: Wire the helper into the affected pages

**Files:**
- Modify: `apps/web/src/app/components/HomeContent.tsx`
- Modify: `apps/web/src/app/api-upload/page.tsx`

- [ ] **Step 1: Update home quick actions to respect roles**

```ts
const [roles, setRoles] = useState<string[]>([]);

useEffect(() => {
  try {
    setRoles(JSON.parse(localStorage.getItem('roles') || '[]'));
  } catch {
    setRoles([]);
  }
}, []);

const quickActions = ALL_QUICK_ACTIONS.filter((item) => hasRequiredRole(roles, item.roles));
```

- [ ] **Step 2: Add the missing role guard to `/api-upload`**

```tsx
import AuthGuard from '../components/AuthGuard';

export default function ApiUploadProtectedPage() {
  return (
    <AuthGuard allowedRoles={['admin', 'flow_manager']}>
      <ApiUploadPage />
    </AuthGuard>
  );
}
```

- [ ] **Step 3: Run the targeted test again**

Run: `corepack pnpm --dir apps/web exec jest src/app/lib/access-control.test.ts --runInBand`
Expected: PASS

- [ ] **Step 4: Run the browser validation script**

Run: `node .logs/frontend-e2e-test.js`
Expected: regular user no longer reaches `/api-upload`, and the home page no longer exposes the bootstrap quick action to that role.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/components/HomeContent.tsx apps/web/src/app/api-upload/page.tsx
git commit -m "fix: align web admin access points"
```
