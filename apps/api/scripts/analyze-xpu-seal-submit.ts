import fs from 'node:fs';
import path from 'node:path';
import { UrlNetworkSubmitService } from '../src/modules/delivery-runtime/url-network-submit.service';

function getArg(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toFieldBindings(schemaFields: Array<Record<string, any>>) {
  return schemaFields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    id: field.id,
    multiple: field.multiple,
    options: field.options,
  }));
}

async function main() {
  const reportPath = path.resolve(
    process.cwd(),
    getArg('--report', 'apps/api/.logs/xpu-inspect/verify-frontend-url-chat-submit-1776604618238.json')!,
  );
  const configPath = path.resolve(
    process.cwd(),
    getArg('--config', 'apps/api/scripts/config-examples/xpu-seal-url-bridge.json')!,
  );
  const uploadFilePath = path.resolve(
    process.cwd(),
    getArg('--upload-file', 'uploads/attachments/raw/ef579753-62ca-4dfa-9eab-107b1add69d3.pdf')!,
  );

  const report = readJson(reportPath);
  const config = readJson(configPath);
  const preflightExtractedValues =
    report?.steps?.submission?.detail?.submitResult?.metadata?.preflight?.extractedValues || {};
  if (
    preflightExtractedValues?.saveDraft
    && typeof preflightExtractedValues.saveDraft === 'object'
    && preflightExtractedValues.saveDraftFields
    && typeof preflightExtractedValues.saveDraftFields === 'object'
  ) {
    preflightExtractedValues.saveDraft.fields = preflightExtractedValues.saveDraftFields;
  }

  const service = new UrlNetworkSubmitService({ run: async () => ({ success: true }) } as any);
  const deliveryContext = {
    runtime: config.runtime,
    ticket: {
      jumpUrl: config.platform?.jumpUrlTemplate || report?.steps?.submission?.detail?.submitResult?.metadata?.jumpUrl || '',
      headers: {},
    },
    authConfig: {},
    rpaFlow: {
      processCode: config.processCode,
      processName: config.processName,
      rpaDefinition: {
        fields: toFieldBindings(config.schema?.fields || []),
        runtime: config.runtime,
        platform: config.platform,
      },
    },
  } as any;

  const input = {
    action: 'submit' as const,
    connectorId: 'debug-connector',
    processCode: config.processCode,
    processName: config.processName,
    payload: {
      formData: {
        fileSummary: '测试用印材料1份',
        sealTypes: ['党委公章'],
      },
      attachments: [
        {
          fieldKey: 'sealAttachment',
          filename: path.basename(uploadFilePath),
          mimeType: 'application/pdf',
          content: fs.readFileSync(uploadFilePath),
        },
      ],
    },
    context: deliveryContext,
  };

  const requestContext = (service as any).buildRequestContext(input, preflightExtractedValues);
  const request = (service as any).buildHttpRequest(config.runtime.networkSubmit, requestContext, deliveryContext);

  const formData = request.data as FormData;
  const entries = Array.from((formData as any).entries?.() || []);
  const mappedEntries = entries.map(([key, value]) => [
    key,
    typeof value === 'string'
      ? value
      : (value as any)?.name || `[binary:${(value as any)?.type || 'application/octet-stream'}]`,
  ]);

  const result = {
    url: request.url,
    method: request.method,
    headers: request.headers,
    entryCount: mappedEntries.length,
    interestingEntries: Object.fromEntries(
      mappedEntries.filter(([key]) =>
        ['_json_params', 'CSRFTOKEN', 'contentSaveId', 'contentZWID', 'field0050', 'field0053', 'field0054'].includes(String(key))),
    ),
  } as Record<string, any>;

  const jsonParamsEntry = mappedEntries.find(([key]) => key === '_json_params');
  if (jsonParamsEntry && typeof jsonParamsEntry[1] === 'string') {
    result.jsonParamsContains = {
      field0050: jsonParamsEntry[1].includes('field0050'),
      field0053: jsonParamsEntry[1].includes('field0053'),
      field0054: jsonParamsEntry[1].includes('field0054'),
    };
    try {
      const parsed = JSON.parse(jsonParamsEntry[1]);
      const colMainData = parsed?.colMainData || {};
      result.colMainDataSubset = {
        field0050: colMainData.field0050,
        field0053: colMainData.field0053,
        field0054: colMainData.field0054,
        field0055: colMainData.field0055,
        field0056: colMainData.field0056,
        field0057: colMainData.field0057,
        field0058: colMainData.field0058,
        field0059: colMainData.field0059,
        field0060: colMainData.field0060,
      };
    } catch (error: any) {
      result.jsonParamsParseError = error?.message || String(error);
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
