import { apiClient } from './apiClient'
import type { IngressAuth, MappingConfig, EgressConfig } from '@/types'

// ─── Sources ─────────────────────────────────────────────────────────────────

export const sourceService = {
  async list(): Promise<string[]> {
    const { data } = await apiClient.post('/admin/source/list', {})
    return data.sources ?? []
  },

  async init(sourceId: string, force = false): Promise<void> {
    await apiClient.post('/admin/source/init', { source: sourceId, force })
  },
}

// ─── Ingress Auth ─────────────────────────────────────────────────────────────

export const authService = {
  async get(sourceId: string): Promise<IngressAuth> {
    const { data } = await apiClient.post('/admin/source/auth/get', { source: sourceId })
    return data.auth as IngressAuth
  },

  async set(sourceId: string, auth: IngressAuth): Promise<void> {
    await apiClient.post('/admin/source/auth/set', { source: sourceId, auth })
  },
}

// ─── Mapping ──────────────────────────────────────────────────────────────────

export const mappingService = {
  async get(sourceId: string): Promise<MappingConfig> {
    const { data } = await apiClient.post('/admin/mapping/get', { source: sourceId })
    return data.mapping as MappingConfig
  },

  async set(sourceId: string, mapping: MappingConfig): Promise<void> {
    await apiClient.post('/admin/mapping/set', { source: sourceId, mapping })
  },
}

// ─── Egress (FlightHub2) ──────────────────────────────────────────────────────

export const egressService = {
  async get(sourceId: string): Promise<EgressConfig> {
    const { data } = await apiClient.post('/admin/flighthub/get', { source: sourceId })
    return data.config as EgressConfig
  },

  async set(sourceId: string, config: EgressConfig): Promise<void> {
    await apiClient.post('/admin/flighthub/set', { source: sourceId, config })
  },
}

// ─── Token extractor ─────────────────────────────────────────────────────────

export const tokenService = {
  async extract(raw: string): Promise<Record<string, string>> {
    const { data } = await apiClient.post('/admin/token/extract', { raw })
    return data.extracted ?? {}
  },
}

// ─── Integration test ─────────────────────────────────────────────────────────

export interface TestPayload {
  sourceId: string
  ingressToken: string
  webhookEvent: Record<string, unknown>
}

export interface TestResult {
  authStatus: number
  queueAccepted: boolean
  error?: string
}

export async function runIntegrationTest(p: TestPayload): Promise<TestResult> {
  try {
    const resp = await apiClient.post(
      '/webhook',
      { source: p.sourceId, webhook_event: p.webhookEvent },
      { headers: { 'X-MW-Token': p.ingressToken }, validateStatus: () => true },
    )
    return {
      authStatus: resp.status,
      queueAccepted: resp.status === 200 && resp.data?.status === 'accepted',
      error: resp.status !== 200 ? JSON.stringify(resp.data) : undefined,
    }
  } catch (e) {
    return { authStatus: 0, queueAccepted: false, error: String(e) }
  }
}
