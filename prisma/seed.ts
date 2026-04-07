#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const defaultTenantId = (process.env.DEFAULT_TENANT_ID || '').trim();
  console.log('🌱 Seeding database...');

  // Create default tenant
  const tenant = await prisma.tenant.upsert({
    where: { code: 'default' },
    update: {},
    create: {
      ...(defaultTenantId ? { id: defaultTenantId } : {}),
      code: 'default',
      name: 'Default Tenant',
      status: 'active',
    },
  });

  console.log('✅ Created tenant:', tenant.name);

  // Create admin user
  const adminUser = await prisma.user.upsert({
    where: { tenantId_username: { tenantId: tenant.id, username: 'admin' } },
    update: { roles: ['admin', 'flow_manager'] },
    create: {
      tenantId: tenant.id,
      username: 'admin',
      email: 'admin@example.com',
      displayName: 'Administrator',
      roles: ['admin', 'flow_manager'],
      status: 'active',
    },
  });

  console.log('✅ Created admin user:', adminUser.username);

  // Create test user
  const testUser = await prisma.user.upsert({
    where: { tenantId_username: { tenantId: tenant.id, username: 'testuser' } },
    update: { roles: ['user'] },
    create: {
      tenantId: tenant.id,
      username: 'testuser',
      email: 'test@example.com',
      displayName: 'Test User',
      roles: ['user'],
      status: 'active',
    },
  });

  console.log('✅ Created test user:', testUser.username);

  console.log('🎉 Seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
