import {
  type CipherGCMTypes,
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { getAuthSessionSecret } from '../common/auth-session-secret';

const ALGORITHM: CipherGCMTypes = 'aes-256-gcm';

function getDelegatedCredentialSecret() {
  return process.env.DELEGATED_CREDENTIAL_SECRET || getAuthSessionSecret();
}

function getEncryptionKey() {
  return createHash('sha256')
    .update(getDelegatedCredentialSecret())
    .digest();
}

export function encryptDelegatedCredentialPayload(payload: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const serialized = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(serialized), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    algorithm: ALGORITHM,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  });
}

export function decryptDelegatedCredentialPayload<T = string>(payload: string): T {
  const parsed = JSON.parse(payload || '{}') as {
    algorithm?: string;
    iv?: string;
    tag?: string;
    data?: string;
  };

  if (!parsed.iv || !parsed.tag || !parsed.data) {
    throw new Error('Encrypted delegated credential payload is malformed');
  }

  const decipher = createDecipheriv(
    parsed.algorithm || ALGORITHM,
    getEncryptionKey(),
    Buffer.from(parsed.iv, 'base64'),
  ) as ReturnType<typeof createDecipheriv> & { setAuthTag(tag: Buffer): void };
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.data, 'base64')),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8')) as T;
}
