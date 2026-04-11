export type IntegrationCapability =
  | 'submit'
  | 'queryStatus'
  | 'cancel'
  | 'urge'
  | 'delegate'
  | 'supplement'
  | 'sync'
  | 'permission.check';

export type AuthChoiceMode = 'service' | 'user';

export type AuthArtifactType =
  | 'bearer_token'
  | 'api_key'
  | 'basic_credential'
  | 'cookie_jar'
  | 'jump_ticket'
  | 'browser_session'
  | 'unknown';

export type RouteKind = 'api' | 'generic_http' | 'rpa';

export type AuthorizationState =
  | 'ready'
  | 'not_configured'
  | 'requires_user_action';

export interface AuthChoice {
  id: string;
  mode: AuthChoiceMode;
  artifact: AuthArtifactType;
  interactive: boolean;
  callback?: 'oauth2' | 'broker' | 'manual';
}

export interface ProviderManifest {
  provider: string;
  version: string;
  targets: string[];
  capabilities: string[];
  authChoices: AuthChoice[];
  routes: Partial<Record<IntegrationCapability, RouteKind[]>>;
  uiHints?: Record<string, unknown>;
}

export interface AuthArtifact {
  type: AuthArtifactType;
  payloadRef: string;
  payload?: Record<string, any>;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface AuthorizationResolution {
  state: AuthorizationState;
  authChoice: AuthChoice;
  artifact?: AuthArtifact;
}

export interface ResolveAuthorizationInput {
  manifest: ProviderManifest;
  capability: string;
  authChoiceId?: string;
  artifactResolver: (authChoice: AuthChoice) => Promise<AuthArtifact | null>;
}

export interface IntegrationProvider {
  resolveArtifact(input: {
    manifest: ProviderManifest;
    capability: string;
    authChoice: AuthChoice;
    input: unknown;
    authScope?: {
      tenantId?: string;
      userId?: string;
    };
  }): Promise<AuthArtifact | null>;
  execute(input: {
    manifest: ProviderManifest;
    capability: string;
    route: RouteKind;
    authChoice: AuthChoice;
    artifact: AuthArtifact;
    input: unknown;
    authScope?: {
      tenantId?: string;
      userId?: string;
    };
  }): Promise<unknown>;
  normalize(raw: unknown): Promise<ExecutionResult>;
}

export interface ExecuteIntegrationInput {
  manifest: ProviderManifest;
  capability: string;
  input: unknown;
  provider: IntegrationProvider;
  authChoiceId?: string;
  authScope?: {
    tenantId?: string;
    userId?: string;
  };
}

export interface ExecutionResult {
  status:
    | 'awaiting_authorization'
    | 'accepted'
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'partial'
    | 'reconciling';
  data?: unknown;
  errorCode?: string;
  errorMessage?: string;
  authorization?: AuthorizationResolution;
}
