import {
  API_DELIVERY_PATH,
  DELIVERY_PATHS,
  getProcessRuntimeDefinition,
  getProcessRuntimeEndpoints,
  getProcessRuntimePaths,
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

  const runtimePaths = getProcessRuntimePaths(uiHints, action);
  const rpaDefinition = getProcessRuntimeDefinition(uiHints) as RpaFlowDefinition | undefined;
  const runtime = rpaDefinition?.runtime;
  const endpoints = getProcessRuntimeEndpoints(uiHints);
  const directLink = isDirectLinkDefinition(rpaDefinition);
  const hasApi = runtimePaths.includes(API_DELIVERY_PATH)
    || endpoints.some((endpoint) =>
      isApiEndpoint(endpoint)
      && ((action === 'submit' && endpoint?.category === 'submit')
        || (action === 'queryStatus' && ['query', 'status_query'].includes(String(endpoint?.category || '')))),
    );
  const hasFlowAction = action === 'submit'
    ? Boolean(rpaDefinition?.actions?.submit)
    : Boolean(rpaDefinition?.actions?.queryStatus);
  const hasNetworkRequest = action === 'submit'
    ? hasRuntimeNetworkRequest(runtime?.networkSubmit)
    : hasRuntimeNetworkRequest(runtime?.networkStatus);
  const hasVision = runtimePaths.includes(VISION_DELIVERY_PATH)
    || (!directLink && hasFlowAction);
  const hasUrlAction = runtimePaths.includes(URL_DELIVERY_PATH)
    || (directLink && hasNetworkRequest);
  const hasUrl = hasUrlAction && Boolean(
    rpaDefinition?.platform?.entryUrl
    || rpaDefinition?.platform?.jumpUrlTemplate
    || rpaDefinition?.platform?.ticketBrokerUrl
    || (directLink && runtime),
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

function hasRuntimeNetworkRequest(value: unknown) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as Record<string, any>).url === 'string'
    && (value as Record<string, any>).url.trim(),
  );
}

function isDirectLinkDefinition(definition?: RpaFlowDefinition) {
  if (!definition || typeof definition !== 'object') {
    return false;
  }

  const raw = definition as Record<string, any>;
  const metadata = raw.metadata && typeof raw.metadata === 'object'
    ? raw.metadata as Record<string, any>
    : {};
  const accessMode = String(raw.accessMode || metadata.accessMode || '').trim().toLowerCase();
  const sourceType = String(raw.sourceType || metadata.sourceType || '').trim().toLowerCase();

  return accessMode === 'direct_link' || sourceType === 'direct_link';
}
