/**
 * DebugPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Pipeline dry-run debugger.
 * Shows each stage output: raw → flat → normalized → mapped → event
 *
 * Uses POST /admin/debug/run
 */
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Play, ChevronDown, ChevronRight, AlertCircle, CheckCircle2, Bug } from 'lucide-react'
import { debugService, sourceService } from '@/services'
import { useSourceStore } from '@/store'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { DebugResult } from '@/types'
import { useQuery } from '@tanstack/react-query'

// ─── Stage definitions ────────────────────────────────────────────────────────

const STAGES = [
  { key: 'raw',        label: 'Raw Input',        color: 'text-gray-400'   },
  { key: 'flat',       label: 'After Flatten',     color: 'text-blue-400'   },
  { key: 'normalized', label: 'After Adapter',     color: 'text-purple-400' },
  { key: 'mapped',     label: 'After Mapping',     color: 'text-yellow-400' },
  { key: 'event',      label: 'Final Event',       color: 'text-emerald-400'},
]

const SAMPLE_PAYLOAD = JSON.stringify({
  timestamp: '2026-03-19T10:00:00Z',
  creator_id: 'pilot01',
  latitude: 22.543096,
  longitude: 114.057865,
  level: 'warning',
  description: 'obstacle detected',
  Event: {
    Name: 'VMD',
    Source: { Id: 'DJI-001' },
    Level: 'warning',
  },
}, null, 2)

// ─── Stage card ───────────────────────────────────────────────────────────────

function StageCard({
  label,
  color,
  data,
  arrow = true,
}: {
  label: string
  color: string
  data: unknown
  arrow?: boolean
}) {
  const [open, setOpen] = useState(false)
  const isEmpty = data == null

  return (
    <div className="relative">
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <button
          type="button"
          className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors"
          onClick={() => setOpen((v) => !v)}
        >
          <div className="flex items-center gap-2">
            {open ? (
              <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
            )}
            <span className={`text-xs font-semibold font-mono ${color}`}>{label}</span>
          </div>
          {!isEmpty && (
            <span className="text-xs text-gray-400">
              {Object.keys(data as object).length} keys
            </span>
          )}
          {isEmpty && <span className="text-xs text-gray-300">—</span>}
        </button>

        {open && (
          <pre className="text-xs font-mono bg-gray-900 text-gray-200 p-3 overflow-auto max-h-72">
            {isEmpty ? 'null' : JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>

      {arrow && (
        <div className="flex justify-center py-1 text-gray-300 text-xs select-none">↓</div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface DebugPanelProps {
  /** Pre-select a source; user can still change it */
  defaultSource?: string
}

export function DebugPanel({ defaultSource }: DebugPanelProps) {
  const { selected } = useSourceStore()
  const [sourceOverride, setSourceOverride] = useState(defaultSource ?? selected ?? '')
  const [payload, setPayload] = useState(SAMPLE_PAYLOAD)
  const [result, setResult] = useState<DebugResult | null>(null)

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: sourceService.list,
  })

  const { mutate: runDebug, isPending } = useMutation({
    mutationFn: () => {
      let parsed: Record<string, unknown> = {}
      try { parsed = JSON.parse(payload) } catch { parsed = {} }
      return debugService.run(sourceOverride || selected, parsed)
    },
    onSuccess: (data) => setResult(data),
  })

  const srcId = sourceOverride || selected

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Bug className="w-4 h-4 text-brand-600" /> Pipeline Debugger
        </span>
      }
      description="Dry-run the full processing pipeline on a sample payload. No data is queued."
    >
      <div className="space-y-4">
        {/* Controls row */}
        <div className="flex flex-wrap items-end gap-3">
          {/* Source select */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Source</label>
            <select
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              value={sourceOverride}
              onChange={(e) => setSourceOverride(e.target.value)}
            >
              <option value="">— select —</option>
              {sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <Button
            onClick={() => runDebug()}
            loading={isPending}
            disabled={!srcId}
          >
            <Play className="w-4 h-4" /> Run Pipeline
          </Button>

          {result && (
            <span className={`flex items-center gap-1.5 text-sm font-medium ${
              result.status === 'ok' ? 'text-emerald-600' : 'text-red-600'
            }`}>
              {result.status === 'ok'
                ? <><CheckCircle2 className="w-4 h-4" /> All stages OK</>
                : <><AlertCircle className="w-4 h-4" /> Error: {result.message}</>
              }
            </span>
          )}
        </div>

        {/* Payload editor */}
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Sample Payload (webhook_event)</label>
          <textarea
            className="w-full font-mono text-xs border border-gray-300 rounded-lg p-3 h-36 resize-y focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={payload}
            onChange={(e) => { setPayload(e.target.value); setResult(null) }}
            spellCheck={false}
          />
        </div>

        {/* Pipeline stages */}
        {result && (
          <div className="mt-2">
            <p className="text-xs font-medium text-gray-500 mb-3">Pipeline Output</p>
            {STAGES.map((s, i) => (
              <StageCard
                key={s.key}
                label={s.label}
                color={s.color}
                data={(result as unknown as Record<string, unknown>)[s.key]}
                arrow={i < STAGES.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}
