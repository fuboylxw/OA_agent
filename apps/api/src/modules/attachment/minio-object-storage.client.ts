import { createHmac, createHash } from 'crypto';
import { Readable } from 'stream';

interface MinioObjectStorageClientOptions {
  endpoint: string;
  port: number;
  accessKey: string;
  secretKey: string;
  bucket: string;
  useSSL: boolean;
  region?: string;
}

function sha256Hex(payload: Buffer | string) {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, payload: string) {
  return createHmac('sha256', key).update(payload).digest();
}

function strictUriEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeObjectKey(key: string) {
  return key
    .split('/')
    .map((segment) => strictUriEncode(segment))
    .join('/');
}

export class MinioObjectStorageClient {
  private readonly endpoint: string;
  private readonly port: number;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly bucket: string;
  private readonly useSSL: boolean;
  private readonly region: string;
  private bucketReadyPromise?: Promise<void>;

  constructor(options: MinioObjectStorageClientOptions) {
    this.endpoint = options.endpoint;
    this.port = options.port;
    this.accessKey = options.accessKey;
    this.secretKey = options.secretKey;
    this.bucket = options.bucket;
    this.useSSL = options.useSSL;
    this.region = options.region || 'us-east-1';
  }

  async putObject(key: string, body: Buffer, contentType = 'application/octet-stream') {
    await this.ensureBucket();

    const response = await this.send('PUT', this.objectPath(key), {
      body,
      contentType,
    });

    await this.expectStatus(response, [200], `upload object ${key}`);
  }

  async getObjectStream(key: string) {
    await this.ensureBucket();

    const response = await this.send('GET', this.objectPath(key));
    await this.expectStatus(response, [200], `download object ${key}`);

    if (!response.body) {
      throw new Error(`download object ${key} failed: empty response body`);
    }

    return Readable.fromWeb(response.body as any);
  }

  async getObjectBuffer(key: string) {
    await this.ensureBucket();

    const response = await this.send('GET', this.objectPath(key));
    await this.expectStatus(response, [200], `read object ${key}`);

    return Buffer.from(await response.arrayBuffer());
  }

  async objectExists(key: string) {
    await this.ensureBucket();

    const response = await this.send('HEAD', this.objectPath(key));
    if (response.status === 404) {
      return false;
    }

    await this.expectStatus(response, [200], `check object ${key}`);
    return true;
  }

  async deleteObject(key: string) {
    await this.ensureBucket();

    const response = await this.send('DELETE', this.objectPath(key));
    await this.expectStatus(response, [204], `delete object ${key}`);
  }

  private async ensureBucket() {
    if (this.bucketReadyPromise) {
      return this.bucketReadyPromise;
    }

    this.bucketReadyPromise = this.ensureBucketOnce().catch((error) => {
      this.bucketReadyPromise = undefined;
      throw error;
    });

    return this.bucketReadyPromise;
  }

  private async ensureBucketOnce() {
    const headResponse = await this.send('HEAD', this.bucketPath());
    if (headResponse.status === 200) {
      return;
    }

    if (headResponse.status !== 404) {
      await this.expectStatus(headResponse, [200, 404], `check bucket ${this.bucket}`);
      return;
    }

    const createResponse = await this.send('PUT', this.bucketPath());
    await this.expectStatus(createResponse, [200, 409], `create bucket ${this.bucket}`);
  }

  private async send(
    method: string,
    canonicalPath: string,
    options?: {
      body?: Buffer;
      contentType?: string;
    },
  ) {
    const body = options?.body ?? Buffer.alloc(0);
    const requestBody = options?.body ? new Uint8Array(options.body) : undefined;
    const payloadHash = sha256Hex(body);
    const timestamp = this.createTimestamp();
    const dateStamp = timestamp.slice(0, 8);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const host = this.port ? `${this.endpoint}:${this.port}` : this.endpoint;
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': timestamp,
    };

    if (options?.contentType) {
      headers['content-type'] = options.contentType;
    }

    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames
      .map((name) => `${name}:${headers[name].trim()}\n`)
      .join('');
    const signedHeaders = signedHeaderNames.join(';');
    const canonicalRequest = [
      method,
      canonicalPath,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      timestamp,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = this.getSigningKey(dateStamp);
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const authorization = [
      `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', ');

    const url = `${this.useSSL ? 'https' : 'http'}://${host}${canonicalPath}`;

    return fetch(url, {
      method,
      headers: {
        ...headers,
        Authorization: authorization,
      },
      body: requestBody,
    });
  }

  private getSigningKey(dateStamp: string) {
    const dateKey = hmac(`AWS4${this.secretKey}`, dateStamp);
    const regionKey = hmac(dateKey, this.region);
    const serviceKey = hmac(regionKey, 's3');
    return hmac(serviceKey, 'aws4_request');
  }

  private bucketPath() {
    return `/${strictUriEncode(this.bucket)}`;
  }

  private objectPath(key: string) {
    return `/${strictUriEncode(this.bucket)}/${encodeObjectKey(key)}`;
  }

  private createTimestamp() {
    return new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  }

  private async expectStatus(response: Response, expected: number[], action: string) {
    if (expected.includes(response.status)) {
      return;
    }

    const message = await response.text().catch(() => '');
    const details = message ? `: ${message.slice(0, 400)}` : '';
    throw new Error(`${action} failed with ${response.status} ${response.statusText}${details}`);
  }
}
