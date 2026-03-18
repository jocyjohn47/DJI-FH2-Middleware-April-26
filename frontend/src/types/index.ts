// ─── Domain Types ────────────────────────────────────────────────────────────

export type AuthMode = 'static_token'

export interface IngressAuth {
  enabled: boolean
  mode: AuthMode
  header_name: string
  token: string        // masked on read from backend
}

export interface MappingRow {
  src: string          // JSONPath e.g. "$.creator_id"
  dst: string          // unified field name
  type: 'string' | 'int' | 'float' | 'bool' | 'json'
  default: string | number | boolean | null
  required: boolean
}

export interface MappingConfig {
  mappings: MappingRow[]
}

export interface RetryPolicy {
  max_retries: number
  backoff: 'exponential' | 'linear'
}

export interface EgressConfig {
  endpoint: string
  headers: Record<string, string>   // X-User-Token masked on read
  template_body: Record<string, unknown>
  retry_policy: RetryPolicy
}

export interface Source {
  id: string           // same as name / slug
  auth?: IngressAuth
  mapping?: MappingConfig
  egress?: EgressConfig
}

// ─── Pipeline health / overview ──────────────────────────────────────────────

export type StepStatus = 'ok' | 'warn' | 'missing'

export interface PipelineStep {
  label: string
  status: StepStatus
  detail?: string
}

export interface SourcePipeline {
  sourceId: string
  steps: PipelineStep[]
}

// ─── Wizard state ─────────────────────────────────────────────────────────────

export type WizardStep =
  | 'create_source'
  | 'configure_auth'
  | 'configure_mapping'
  | 'configure_egress'
  | 'test'

export interface WizardState {
  currentStep: WizardStep
  sourceId: string
  completedSteps: Set<WizardStep>
}

// ─── API response wrappers ───────────────────────────────────────────────────

export interface ApiOk<T = unknown> {
  status: 'ok'
  data: T
}

export interface ApiError {
  status: 'error'
  message: string
}

export type ApiResult<T = unknown> = ApiOk<T> | ApiError

// ─── UI / role ───────────────────────────────────────────────────────────────

export type Role = 'admin' | 'operator' | 'readonly'
