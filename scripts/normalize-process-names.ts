#!/usr/bin/env tsx

import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { normalizeProcessName } from '../packages/shared-types/src/process-name';

loadEnv({ path: resolve(__dirname, '../.env') });

type PlannedUpdate = {
  table: 'processTemplate' | 'remoteProcess' | 'flowIR';
  id: string;
  from: string;
  to: string;
};

const prisma = new PrismaClient();
const shouldApply = process.argv.includes('--apply');

async function main() {
  const plannedUpdates: PlannedUpdate[] = [];

  const templateUpdates = await collectProcessTemplateUpdates(plannedUpdates);
  const remoteProcessUpdates = await collectRemoteProcessUpdates(plannedUpdates);
  const flowIRUpdates = await collectFlowIRUpdates(plannedUpdates);

  console.log(`processTemplate: ${templateUpdates.length} updates`);
  console.log(`remoteProcess: ${remoteProcessUpdates.length} updates`);
  console.log(`flowIR: ${flowIRUpdates.length} updates`);
  console.log(`total: ${plannedUpdates.length} updates`);

  if (plannedUpdates.length > 0) {
    console.log('\nPreview:');
    for (const item of plannedUpdates.slice(0, 20)) {
      console.log(`[${item.table}] ${item.id}: ${item.from} -> ${item.to}`);
    }
  }

  if (!shouldApply) {
    console.log('\nDry run only. Re-run with --apply to persist these changes.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const item of templateUpdates) {
      await tx.processTemplate.update({
        where: { id: item.id },
        data: {
          processName: item.processName,
          ...(item.uiHintsChanged ? { uiHints: item.uiHints } : {}),
        },
      });
    }

    for (const item of remoteProcessUpdates) {
      await tx.remoteProcess.update({
        where: { id: item.id },
        data: {
          remoteProcessName: item.remoteProcessName,
          ...(item.metadataChanged ? { metadata: item.metadata } : {}),
        },
      });
    }

    for (const item of flowIRUpdates) {
      await tx.flowIR.update({
        where: { id: item.id },
        data: {
          flowName: item.flowName,
        },
      });
    }
  });

  console.log('\nApplied process-name normalization successfully.');
}

async function collectProcessTemplateUpdates(plannedUpdates: PlannedUpdate[]) {
  const templates = await prisma.processTemplate.findMany({
    select: {
      id: true,
      processCode: true,
      processName: true,
      uiHints: true,
    },
  });

  const updates: Array<{
    id: string;
    processName: string;
    uiHints: Record<string, any> | null;
    uiHintsChanged: boolean;
  }> = [];

  for (const template of templates) {
    const processName = normalizeProcessName({
      processName: template.processName,
      processCode: template.processCode,
    });
    const uiHints = normalizeUiHintsFlowName(template.uiHints as Record<string, any> | null, template.processCode, processName);
    const uiHintsChanged = JSON.stringify(uiHints) !== JSON.stringify(template.uiHints);

    if (processName === template.processName && !uiHintsChanged) {
      continue;
    }

    if (processName !== template.processName) {
      plannedUpdates.push({
        table: 'processTemplate',
        id: template.id,
        from: template.processName,
        to: processName,
      });
    }

    updates.push({
      id: template.id,
      processName,
      uiHints,
      uiHintsChanged,
    });
  }

  return updates;
}

async function collectRemoteProcessUpdates(plannedUpdates: PlannedUpdate[]) {
  const remoteProcesses = await prisma.remoteProcess.findMany({
    select: {
      id: true,
      remoteProcessCode: true,
      remoteProcessName: true,
      metadata: true,
    },
  });

  const updates: Array<{
    id: string;
    remoteProcessName: string;
    metadata: Record<string, any> | null;
    metadataChanged: boolean;
  }> = [];

  for (const remoteProcess of remoteProcesses) {
    const processName = normalizeProcessName({
      processName: remoteProcess.remoteProcessName,
      processCode: remoteProcess.remoteProcessCode,
    });
    const metadata = normalizeMetadataFlowName(
      remoteProcess.metadata as Record<string, any> | null,
      remoteProcess.remoteProcessCode,
      processName,
    );
    const metadataChanged = JSON.stringify(metadata) !== JSON.stringify(remoteProcess.metadata);

    if (processName === remoteProcess.remoteProcessName && !metadataChanged) {
      continue;
    }

    if (processName !== remoteProcess.remoteProcessName) {
      plannedUpdates.push({
        table: 'remoteProcess',
        id: remoteProcess.id,
        from: remoteProcess.remoteProcessName,
        to: processName,
      });
    }

    updates.push({
      id: remoteProcess.id,
      remoteProcessName: processName,
      metadata,
      metadataChanged,
    });
  }

  return updates;
}

async function collectFlowIRUpdates(plannedUpdates: PlannedUpdate[]) {
  const flowIRs = await prisma.flowIR.findMany({
    select: {
      id: true,
      flowCode: true,
      flowName: true,
    },
  });

  const updates: Array<{
    id: string;
    flowName: string;
  }> = [];

  for (const flow of flowIRs) {
    const flowName = normalizeProcessName({
      processName: flow.flowName,
      processCode: flow.flowCode,
    });

    if (flowName === flow.flowName) {
      continue;
    }

    plannedUpdates.push({
      table: 'flowIR',
      id: flow.id,
      from: flow.flowName,
      to: flowName,
    });

    updates.push({
      id: flow.id,
      flowName,
    });
  }

  return updates;
}

function normalizeUiHintsFlowName(
  uiHints: Record<string, any> | null,
  processCode: string,
  normalizedName: string,
): Record<string, any> | null {
  if (!uiHints || typeof uiHints !== 'object' || Array.isArray(uiHints)) {
    return uiHints;
  }

  const nextUiHints = JSON.parse(JSON.stringify(uiHints)) as Record<string, any>;
  if (nextUiHints.discovery?.flow && typeof nextUiHints.discovery.flow === 'object') {
    nextUiHints.discovery.flow.flowName = normalizeProcessName({
      processName: nextUiHints.discovery.flow.flowName || normalizedName,
      processCode,
    });
  }

  return nextUiHints;
}

function normalizeMetadataFlowName(
  metadata: Record<string, any> | null,
  processCode: string | null,
  normalizedName: string,
): Record<string, any> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return metadata;
  }

  const nextMetadata = JSON.parse(JSON.stringify(metadata)) as Record<string, any>;
  if (nextMetadata.flow && typeof nextMetadata.flow === 'object') {
    nextMetadata.flow.flowName = normalizeProcessName({
      processName: nextMetadata.flow.flowName || normalizedName,
      processCode,
    });
  }

  return nextMetadata;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
