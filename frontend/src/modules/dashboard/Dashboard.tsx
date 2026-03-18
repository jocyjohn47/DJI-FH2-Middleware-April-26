import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { sourceService, authService, mappingService, egressService } from '@/services'
import { useSourceStore, useWizardStore } from '@/store'
import { Card, Badge } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Zap, ArrowRight, CheckCircle, AlertCircle, XCircle, Layers } from 'lucide-react'
import type { StepStatus, SourcePipeline } from '@/types'

function statusBadge(s: StepStatus) {
  if (s === 'ok')      return <Badge variant="green">✓ OK</Badge>
  if (s === 'warn')    return <Badge variant="yellow">⚠ Partial</Badge>
  return                      <Badge variant="red">✗ Missing</Badge>
}

function statusIcon(s: StepStatus) {
  if (s === 'ok')   return <CheckCircle className="w-4 h-4 text-emerald-500" />
  if (s === 'warn') return <AlertCircle className="w-4 h-4 text-amber-500" />
  return                   <XCircle     className="w-4 h-4 text-red-400" />
}

export function Dashboard() {
  const navigate = useNavigate()
  const { setSources, sources, setSelected } = useSourceStore()
  const { startWizard } = useWizardStore()

  const { isLoading } = useQuery({
    queryKey: ['sources'],
    queryFn: sourceService.list,
    onSuccess: setSources,
  } as Parameters<typeof useQuery>[0])

  // Per-source pipeline health
  const pipelineQueries = useQuery({
    queryKey: ['pipeline-health', sources],
    enabled: sources.length > 0,
    queryFn: async (): Promise<SourcePipeline[]> => {
      return Promise.all(
        sources.map(async (id) => {
          const [auth, mapping, egress] = await Promise.allSettled([
            authService.get(id),
            mappingService.get(id),
            egressService.get(id),
          ])

          const authCfg  = auth.status   === 'fulfilled' ? auth.value   : null
          const mapCfg   = mapping.status === 'fulfilled' ? mapping.value : null
          const egsCfg   = egress.status  === 'fulfilled' ? egress.value  : null

          const authStatus: StepStatus =
            authCfg?.enabled && authCfg?.token && !authCfg.token.includes('****') ? 'ok' :
            authCfg ? 'warn' : 'missing'

          const mapStatus: StepStatus =
            (mapCfg?.mappings?.length ?? 0) > 0 ? 'ok' : 'missing'

          const egsStatus: StepStatus =
            egsCfg?.endpoint ? (egsCfg.headers?.['X-User-Token'] ? 'ok' : 'warn') : 'missing'

          return {
            sourceId: id,
            steps: [
              { label: 'Source',   status: 'ok'        as StepStatus },
              { label: 'Auth',     status: authStatus,  detail: authCfg?.header_name },
              { label: 'Mapping',  status: mapStatus,   detail: `${mapCfg?.mappings?.length ?? 0} rules` },
              { label: 'Egress',   status: egsStatus,   detail: egsCfg?.endpoint?.slice(8, 40) },
            ],
          }
        }),
      )
    },
  } as Parameters<typeof useQuery>[0])

  const pipelines: SourcePipeline[] = (pipelineQueries.data as SourcePipeline[] | undefined) ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            FlightHub Webhook Transformer — DJI FlightHub2
          </p>
        </div>
        <Button onClick={() => { startWizard(); navigate('/wizard') }}>
          <Zap className="w-4 h-4" /> New Integration
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Sources" value={sources.length} icon={<Layers className="w-5 h-5 text-brand-500" />} />
        <StatCard
          label="Healthy Pipelines"
          value={pipelines.filter(p => p.steps.every(s => s.status !== 'missing')).length}
          icon={<CheckCircle className="w-5 h-5 text-emerald-500" />}
        />
        <StatCard
          label="Needs Attention"
          value={pipelines.filter(p => p.steps.some(s => s.status === 'missing')).length}
          icon={<AlertCircle className="w-5 h-5 text-amber-500" />}
        />
      </div>

      {/* Pipeline cards */}
      <div>
        <h2 className="text-base font-semibold text-gray-800 mb-3">Integration Pipelines</h2>
        {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
        {!isLoading && sources.length === 0 && (
          <Card>
            <div className="text-center py-12">
              <Zap className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No integrations yet</p>
              <Button className="mt-4" onClick={() => { startWizard(); navigate('/wizard') }}>
                Create your first integration
              </Button>
            </div>
          </Card>
        )}

        <div className="space-y-3">
          {pipelines.map((p) => (
            <Card key={p.sourceId}>
              <div className="flex items-center gap-4">
                {/* Source name */}
                <div className="w-32 shrink-0">
                  <span className="font-mono text-sm font-semibold text-gray-800">{p.sourceId}</span>
                </div>

                {/* Pipeline steps */}
                <div className="flex-1 flex items-center gap-2">
                  {p.steps.map((step, i) => (
                    <div key={step.label} className="flex items-center gap-2">
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="flex items-center gap-1">
                          {statusIcon(step.status)}
                          <span className="text-xs font-medium text-gray-600">{step.label}</span>
                        </div>
                        {step.detail && (
                          <span className="text-xs text-gray-400 font-mono truncate max-w-[100px]">{step.detail}</span>
                        )}
                      </div>
                      {i < p.steps.length - 1 && (
                        <ArrowRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                      )}
                    </div>
                  ))}
                </div>

                {/* Status badge */}
                <div>
                  {statusBadge(
                    p.steps.every(s => s.status === 'ok') ? 'ok' :
                    p.steps.some(s => s.status === 'missing') ? 'missing' : 'warn'
                  )}
                </div>

                {/* Action */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setSelected(p.sourceId); startWizard(p.sourceId); navigate('/wizard') }}
                >
                  Configure <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center border border-gray-200">
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="text-xs text-gray-500">{label}</p>
        </div>
      </div>
    </Card>
  )
}

import type React from 'react'
