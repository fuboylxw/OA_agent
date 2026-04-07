export type AuthCredentialFieldKind =
  | 'username'
  | 'password'
  | 'token'
  | 'verification_code';

interface AuthFieldInput {
  key?: string | null;
  label?: string | null;
  description?: string | null;
}

const EXACT_USERNAME_LABELS = new Set([
  '账号',
  '用户名',
  '用户账号',
  '登录账号',
  '登录用户名',
  '登录工号',
]);

function normalizeFragments(values: Array<string | null | undefined>) {
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) =>
      value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_./-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase(),
    )
    .join(' ');
}

export function detectAuthCredentialFieldKind(input: AuthFieldInput): AuthCredentialFieldKind | null {
  const key = String(input.key || '').trim();
  const label = String(input.label || '').trim();
  const description = String(input.description || '').trim();
  const normalized = normalizeFragments([key, label, description]);

  if (!normalized) {
    return null;
  }

  if (/(password|passwd|pwd|密码|口令|passcode|pin(?:\s|$)|pin code)/.test(normalized)) {
    return 'password';
  }

  if (/(captcha|otp|one time password|verification code|验证码|校验码|短信验证码|动态码)/.test(normalized)) {
    return 'verification_code';
  }

  if (/(access token|refresh token|bearer token|api key|apikey|appkey|app secret|appsecret|client secret|token|cookie|session(?:\s|$| id)|ticket|票据)/.test(normalized)) {
    return 'token';
  }

  const hasLoginContext = /(login|sign in|signin|auth|authentication|认证|登录|登陆|单点|sso)/.test(normalized)
    || /^login[_./-]/i.test(key)
    || /^auth[_./-]/i.test(key);
  const usernameLike = /(username|user name|login name|login id|account|账号|账户|工号|employee id|employee number|employee no|邮箱|email|手机号|phone|mobile)/.test(normalized);
  const exactUsernameLike = /^(username|user name|login name|login id|用户名|用户账号|登录账号|登录用户名|登录工号)$/.test(normalized);

  if (usernameLike && (hasLoginContext || EXACT_USERNAME_LABELS.has(label) || exactUsernameLike)) {
    return 'username';
  }

  return null;
}

export function isAuthCredentialField(input: AuthFieldInput) {
  return detectAuthCredentialFieldKind(input) !== null;
}

export function buildAuthCredentialPlaceholder(kind: AuthCredentialFieldKind) {
  switch (kind) {
    case 'username':
      return '{{auth.username}}';
    case 'password':
      return '{{auth.password}}';
    case 'token':
      return '{{auth.accessToken}}';
    case 'verification_code':
      return '{{auth.verificationCode}}';
    default:
      return '';
  }
}

export function resolveAuthCredentialValue(
  kind: AuthCredentialFieldKind,
  auth?: Record<string, any>,
) {
  const authConfig = auth || {};

  switch (kind) {
    case 'username':
      return authConfig.username
        ?? authConfig.userName
        ?? authConfig.account
        ?? authConfig.loginId
        ?? authConfig.employeeId;
    case 'password':
      return authConfig.password;
    case 'token':
      return authConfig.accessToken
        ?? authConfig.token
        ?? authConfig.apiKey
        ?? authConfig.sessionCookie
        ?? authConfig.cookie;
    case 'verification_code':
      return authConfig.verificationCode
        ?? authConfig.captcha
        ?? authConfig.otp
        ?? authConfig.code;
    default:
      return undefined;
  }
}
