#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create default tenant
  const tenant = await prisma.tenant.upsert({
    where: { code: 'default' },
    update: {},
    create: {
      code: 'default',
      name: 'Default Tenant',
      status: 'active',
    },
  });

  console.log('✅ Created tenant:', tenant.name);

  // Create admin user
  const adminUser = await prisma.user.upsert({
    where: { tenantId_username: { tenantId: tenant.id, username: 'admin' } },
    update: {},
    create: {
      tenantId: tenant.id,
      username: 'admin',
      email: 'admin@example.com',
      displayName: 'Administrator',
      roles: JSON.stringify(['admin', 'flow_manager']),
      status: 'active',
    },
  });

  console.log('✅ Created admin user:', adminUser.username);

  // Create test user
  const testUser = await prisma.user.upsert({
    where: { tenantId_username: { tenantId: tenant.id, username: 'testuser' } },
    update: {},
    create: {
      tenantId: tenant.id,
      username: 'testuser',
      email: 'test@example.com',
      displayName: 'Test User',
      roles: JSON.stringify(['user']),
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
