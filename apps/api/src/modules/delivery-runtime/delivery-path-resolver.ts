import {
  API_DELIVERY_PATH,
  DELIVERY_PATHS,
  isDeliveryPath,
  type DeliveryPath,
  type RpaFlowDefinition,
  URL_DELIVERY_PATH,
  VISION_DELIVERY_PATH,
} from '@uniflow/shared-types';

export function resolveAvailablePaths(
  uiHints: Record<string, any>,
  action: 'submit' | 'queryStatus',
): DeliveryPath[] {
  const explicit = uiHints.delivery as Record<string, any> | undefined;
  if (explicit) {
    const ordered = Array.isArray(explicit.fallbackOrder)
      ? explicit.fallbackOrder.filter(isDeliveryPath)
      : DELIVERY_PATHS;
    return ordered.filter((path) => isPathEnabled(explicit[path], action));
  }

  const executionModes = (uiHints.executionModes as Record<string, any> | undefined) || {};
  const rpaDefinition = uiHints.rpaDefinition as RpaFlowDefinition | undefined;
  const endpoints = Array.isArray(uiHints.endpoints) ? uiHints.endpoints : [];
  const hasApi = includesMode(executionModes[action], 'api')
    || endpoints.some((endpoint) =>
      isApiEndpoint(endpoint)
      && ((action === 'submit' && endpoint?.category === 'submit')
        || (action === 'queryStatus' && ['query', 'status_query'].includes(String(endpoint?.category || '')))),
    );
  const hasFlowAction = action === 'submit'
    ? Boolean(rpaDefinition?.actions?.submit)
    : Boolean(rpaDefinition?.actions?.queryStatus);
  const hasVision = hasFlowAction;
  const hasUrl = hasFlowAction && Boolean(
    rpaDefinition?.platform?.entryUrl
    || rpaDefinition?.platform?.jumpUrlTemplate
    || rpaDefinition?.platform?.ticketBrokerUrl
    || rpaDefinition?.runtime,
  );
  const preferred: DeliveryPath[] = hasVision
    ? [API_DELIVERY_PATH, VISION_DELIVERY_PATH, URL_DELIVERY_PATH]
    : [API_DELIVERY_PATH, URL_DELIVERY_PATH, VISION_DELIVERY_PATH];
  return preferred.filter((path) => {
    if (path === API_DELIVERY_PATH) return hasApi;
    if (path === VISION_DELIVERY_PATH) return hasVision;
    return hasUrl;
  });
}

export function buildExecutionOrder(
  preferredPath: DeliveryPath | null | undefined,
  fallbackPolicy: DeliveryPath[] | undefined,
  availablePaths: DeliveryPath[],
): DeliveryPath[] {
  const allowed = new Set(availablePaths);
  const ordered = new Set<DeliveryPath>();
  for (const candidate of [preferredPath, ...(fallbackPolicy || []), ...availablePaths]) {
    if (isDeliveryPath(candidate) && allowed.has(candidate)) {
      ordered.add(candidate);
    }
  }
  return [...ordered];
}

function isPathEnabled(raw: unknown, action: 'submit' | 'queryStatus') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }
  const value = raw as Record<string, any>;
  const health = String(value.health || '').toLowerCase();
  if (value.available !== true) {
    return false;
  }
  if (health === 'unavailable') {
    return false;
  }
  return action === 'submit'
    ? Boolean(value.submitEnabled)
    : Boolean(value.queryEnabled);
}

function isApiEndpoint(endpoint: any) {
  return String(endpoint?.method || '').toUpperCase() !== 'RPA';
}

function includesMode(value: unknown, mode: string) {
  return Array.isArray(value) && value.some((item) => String(item).toLowerCase() === mode);
}
