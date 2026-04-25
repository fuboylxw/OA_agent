export function buildChatFlowHref(input: {
  processCode: string;
  templateId?: string | null;
  connectorId?: string | null;
}) {
  const params = new URLSearchParams({
    flow: input.processCode,
  });

  if (input.templateId) {
    params.set('templateId', input.templateId);
  }

  if (input.connectorId) {
    params.set('connectorId', input.connectorId);
  }

  return `/chat?${params.toString()}`;
}
