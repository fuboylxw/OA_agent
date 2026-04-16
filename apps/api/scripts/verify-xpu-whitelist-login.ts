import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';
import { sm2 } from 'sm-crypto';

type VerifyArgs = {
  account?: string;
  pageUrl: string;
  skipBrowser: boolean;
};

type BrowserCookie = {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
};

function parseArgs(argv: string[]): VerifyArgs {
  const args: VerifyArgs = {
    pageUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
    skipBrowser: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case '--account':
        args.account = argv[index + 1];
        index += 1;
        break;
      case '--page-url':
        args.pageUrl = argv[index + 1] || args.pageUrl;
        index += 1;
        break;
      case '--skip-browser':
        args.skipBrowser = true;
        break;
      default:
        break;
    }
  }

  return args;
}

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

function extractSm2PrivateKeyHex(rawKey: string) {
  const exported = Buffer.from(rawKey.trim(), 'base64').toString('hex');
  const match = exported.match(/0201010420([0-9a-f]{64})/i);
  if (!match) {
    throw new Error('Unable to extract SM2 private scalar from AUTH_OAUTH2_PRIVATE_KEY');
  }
  return match[1];
}

async function resolveAccount(input?: string) {
  if (input?.trim()) {
    return input.trim();
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL, please pass --account explicitly');
  }

  const prisma = new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });

  try {
    const user = await prisma.user.findFirst({
      where: {
        status: 'active',
        NOT: {
          username: 'admin',
        },
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        username: true,
      },
    });

    if (!user?.username) {
      throw new Error('No active non-admin user found, please pass --account explicitly');
    }

    return user.username;
  } finally {
    await prisma.$disconnect();
  }
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

async function requestLoginCookie(account: string) {
  const payload = buildSignedPayload(account);
  const pathWithQuery = `/auth2/api/v1/login?${new URLSearchParams(payload).toString()}`;

  return new Promise<{
    statusCode: number;
    body: string;
    setCookie: string[];
  }>((resolve, reject) => {
    const request = https.request({
      hostname: 'sz.xpu.edu.cn',
      port: 443,
      method: 'GET',
      path: pathWithQuery,
    }, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk.toString();
      });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode || 0,
          body,
          setCookie: Array.isArray(response.headers['set-cookie'])
            ? response.headers['set-cookie'].map(String)
            : response.headers['set-cookie']
              ? [String(response.headers['set-cookie'])]
              : [],
        });
      });
    });

    request.on('error', reject);
    request.end();
  });
}

function parseSetCookie(header: string): BrowserCookie {
  const parts = header.split(';').map((part) => part.trim()).filter(Boolean);
  const [nameValue, ...attributes] = parts;
  const separatorIndex = nameValue.indexOf('=');
  const cookie: BrowserCookie = {
    name: nameValue.slice(0, separatorIndex),
    value: nameValue.slice(separatorIndex + 1),
    path: '/',
    url: 'https://sz.xpu.edu.cn',
  };

  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split('=');
    const key = rawKey.toLowerCase();
    const value = rest.join('=');
    if (key === 'domain' && value) {
      delete cookie.url;
      cookie.domain = value;
    }
    if (key === 'path' && value) {
      cookie.path = value;
    }
    if (key === 'secure') {
      cookie.secure = true;
    }
    if (key === 'httponly') {
      cookie.httpOnly = true;
    }
  }

  return cookie;
}

async function verifyBrowser(pageUrl: string, cookies: string[]) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookies.map(parseSetCookie));

    const page = await context.newPage();
    await page.goto(pageUrl, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    return {
      finalUrl: page.url(),
      title: await page.title(),
      bodyPreview: (await page.locator('body').innerText()).slice(0, 300),
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  loadRootEnv();
  const args = parseArgs(process.argv.slice(2));
  const account = await resolveAccount(args.account);
  const loginResult = await requestLoginCookie(account);

  const parsedBody = (() => {
    try {
      return JSON.parse(loginResult.body);
    } catch {
      return loginResult.body;
    }
  })();

  const output: Record<string, any> = {
    account,
    login: {
      statusCode: loginResult.statusCode,
      setCookieCount: loginResult.setCookie.length,
      body: parsedBody,
    },
  };

  if (!args.skipBrowser && loginResult.setCookie.length > 0) {
    output.browser = await verifyBrowser(args.pageUrl, loginResult.setCookie);
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
