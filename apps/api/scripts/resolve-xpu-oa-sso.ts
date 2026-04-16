import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import crypto from 'node:crypto';
import axios from 'axios';
import { sm2 } from 'sm-crypto';

function loadRootEnv() {
  const envPath = path.resolve(process.cwd(), '../../.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function getArg(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

function extractSm2PrivateKeyHex(rawKey: string) {
  const exported = Buffer.from(rawKey.trim(), 'base64').toString('hex');
  const match = exported.match(/0201010420([0-9a-f]{64})/i);
  if (!match) {
    throw new Error('Unable to extract SM2 private scalar from AUTH_OAUTH2_PRIVATE_KEY');
  }
  return match[1];
}

function buildSignedPayload(account: string) {
  const clientId = String(process.env.AUTH_OAUTH2_CLIENT_ID || '').trim();
  const privateKey = String(process.env.AUTH_OAUTH2_PRIVATE_KEY || '').trim();
  if (!clientId) {
    throw new Error('Missing AUTH_OAUTH2_CLIENT_ID');
  }
  if (!privateKey) {
    throw new Error('Missing AUTH_OAUTH2_PRIVATE_KEY');
  }

  const payload: Record<string, string> = {
    clientId,
    account,
    timestamp: String(Date.now()),
    nonceStr: crypto.randomBytes(10).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 10),
  };
  const signSource = Object.entries(payload)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  payload.sign = sm2.doSignature(signSource, extractSm2PrivateKeyHex(privateKey), {
    der: true,
    hash: true,
  });
  return payload;
}

async function requestWhitelistCookies(account: string) {
  const payload = buildSignedPayload(account);
  const pathWithQuery = `/auth2/api/v1/login?${new URLSearchParams(payload).toString()}`;

  return new Promise<string[]>((resolve, reject) => {
    const request = https.request({
      hostname: 'sz.xpu.edu.cn',
      port: 443,
      method: 'GET',
      path: pathWithQuery,
    }, (response) => {
      response.resume();
      response.on('end', () => {
        resolve(Array.isArray(response.headers['set-cookie'])
          ? response.headers['set-cookie'].map((cookie) => cookie.split(';')[0])
          : response.headers['set-cookie']
            ? [String(response.headers['set-cookie']).split(';')[0]]
            : []);
      });
    });

    request.on('error', reject);
    request.end();
  });
}

function buildCookieHeader(cookies: string[]) {
  return cookies.join('; ');
}

async function main() {
  loadRootEnv();
  const account = getArg('--account', 'cloudcam');
  const targetTourl = getArg(
    '--tourl',
    '/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=-4191060420802230640&showTab=true',
  );
  const cookies = await requestWhitelistCookies(String(account));
  if (cookies.length === 0) {
    throw new Error('No whitelist cookies returned');
  }

  const cookieHeader = buildCookieHeader(cookies);

  const portalResponse = await axios.get('https://sz.xpu.edu.cn/', {
    maxRedirects: 10,
    headers: {
      Cookie: cookieHeader,
    },
    validateStatus: () => true,
  });
  const responseUrl = portalResponse.request?.res?.responseUrl || '';
  const portalUrl = new URL(responseUrl || 'https://sz.xpu.edu.cn/');
  const code = portalUrl.searchParams.get('code');
  if (!code) {
    throw new Error(`Unable to resolve portal oauth code from ${responseUrl || 'unknown response url'}`);
  }

  const tokenResponse = await axios.post(
    'https://sz.xpu.edu.cn/gate/auth/oauth/token',
    undefined,
    {
      params: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://sz.xpu.edu.cn',
      },
      headers: {
        Cookie: cookieHeader,
      },
      validateStatus: () => true,
    },
  );
  if (tokenResponse.status >= 400 || !tokenResponse.data?.access_token) {
    throw new Error(`Failed to resolve portal access token: HTTP ${tokenResponse.status}`);
  }

  const oaInfoResponse = await axios.get('https://sz.xpu.edu.cn/gate/lobby/api/oa/info', {
    headers: {
      Cookie: cookieHeader,
      Authorization: `Bearer ${tokenResponse.data.access_token}`,
    },
    validateStatus: () => true,
  });
  if (oaInfoResponse.status >= 400 || oaInfoResponse.data?.status !== 'success') {
    throw new Error(`Failed to resolve OA info: HTTP ${oaInfoResponse.status}`);
  }

  const coordinateUrl = String(oaInfoResponse.data?.data?.coordinateUrl || '');
  const workUrl = String(oaInfoResponse.data?.data?.workUrl || '');
  if (!coordinateUrl && !workUrl) {
    throw new Error('OA info response does not contain coordinateUrl/workUrl');
  }

  const baseSsoUrl = new URL(coordinateUrl || workUrl);
  baseSsoUrl.searchParams.set('tourl', targetTourl);

  console.log(JSON.stringify({
    account,
    portalResponseUrl: responseUrl,
    code,
    accessTokenPreview: String(tokenResponse.data.access_token).slice(0, 40),
    oaInfo: oaInfoResponse.data,
    resolvedSsoUrl: baseSsoUrl.toString(),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
