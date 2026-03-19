/**
 * DslEditor.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Visual editor for the new DSL mapping format:
 *
 *   { "dsl": { "field_name": { from, default, cases, transform, type } } }
 *
 * Saves to uw:map:{source} alongside (or instead of) the legacy "mappings" list.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, ChevronDown, ChevronRight, Save } from 'lucide-react'
import { mappingService } from '@/services'
import { useUIStore } from '@/store'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { RuleBuilder } from '@/components/mapping/RuleBuilder'
import type { DslRule, DslCase } from '@/types'

// ─── Row type ─────────────────────────────────────────────────────────────────

interface DslRow {
  dst: string            // target unified field name
  rule: DslRule
  expanded: boolean
}

const TRANSFORM_OPTIONS = [
  { value: '',      label: '— none —' },
  { value: 'upper', label: 'upper' },
  { value: 'lower', label: 'lower' },
  { value: 'strip', label: 'strip' },
  { value: 'int',   label: 'int' },
  { value: 'float', label: 'float' },
  { value: 'bool',  label: 'bool' },
  { value: 'str',   label: 'str' },
]

const TYPE_OPTIONS = [
  { value: '',       label: '— none —' },
  { value: 'string', label: 'string' },
  { value: 'int',    label: 'int' },
  { value: 'float',  label: 'float' },
  { value: 'bool',   label: 'bool' },
  { value: 'json',   label: 'json' },
]

const DEFAULT_ROWS: DslRow[] = [
  { dst: 'event_type', rule: { from: ['event.name'], default: 'unknown', cases: [
    { if: "$.event.name == 'VMD'",      then: 'motion' },
    { if: "$.event.name == 'Tripwire'", then: 'intrusion' },
  ]}, expanded: true },
  { dst: 'device_id', rule: { from: ['device.id', 'deviceId'] }, expanded: false },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dslToRows(dsl: Record<string, DslRule>): DslRow[] {
  return Object.entries(dsl).map(([dst, rule]) => ({
    dst,
    rule,
    expanded: false,
  }))
}

function rowsToDsl(rows: DslRow[]): Record<string, DslRule> {
  const dsl: Record<string, DslRule> = {}
  for (const row of rows) {
    if (!row.dst.trim()) continue
    dsl[row.dst.trim()] = row.rule
  }
  return dsl
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DslEditor({ sourceId }: { sourceId: string }) {
  const { addToast } = useUIStore()
  const qc = useQueryClient()
  const [rows, setRows] = useState<DslRow[]>([])
  const [showPreview, setShowPreview] = useState(false)

  // Load existing mapping
  useQuery({
    queryKey: ['mapping', sourceId],
    queryFn: () => mappingService.get(sourceId),
    enabled: !!sourceId,
    onSuccess: (cfg: { dsl?: Record<string, DslRule>; mappings?: unknown[] }) => {
      if (cfg.dsl && Object.keys(cfg.dsl).length > 0) {
        setRows(dslToRows(cfg.dsl))
      } else {
        setRows(DEFAULT_ROWS)
      }
    },
  } as Parameters<typeof useQuery>[0])

  // Save — merge DSL into existing config (keep legacy mappings)
  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      const existing = await mappingService.get(sourceId)
      const updated = { ...existing, dsl: rowsToDsl(rows) }
      return mappingService.set(sourceId, updated)
    },
    onSuccess: () => {
      addToast('success', 'DSL mapping saved')
      qc.invalidateQueries({ queryKey: ['mapping', sourceId] })
    },
    onError: (e: Error) => addToast('error', e.message),
  })

  const addRow = () =>
    setRows((prev) => [...prev, {
      dst: '',
      rule: { from: [], default: '', cases: [] },
      expanded: true,
    }])

  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i))

  const toggleExpand = (i: number) =>
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, expanded: !r.expanded } : r))

  const updateDst = (i: number, val: string) =>
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, dst: val } : r))

  const updateRule = (i: number, patch: Partial<DslRule>) =>
    setRows((prev) => prev.map((r, idx) =>
      idx === i ? { ...r, rule: { ...r.rule, ...patch } } : r
    ))

  return (
    <div className="space-y-4">
      <Card
        title="DSL Field Mapping"
        description='Advanced mapping: multi-path fallback, conditional cases, transforms. Stored under { "dsl": {...} }'
        actions={
          <Button variant="secondary" size="sm" onClick={addRow}>
            <Plus className="w-3.5 h-3.5" /> Add Field
          </Button>
        }
      >
        {rows.length === 0 && (
          <div className="text-sm text-gray-400 py-6 text-center">
            No DSL rules yet — click "Add Field" to start.
          </div>
        )}

        <div className="space-y-3">
          {rows.map((row, i) => (
            <div key={i} className="border border-gray-200 rounded-xl overflow-hidden">
              {/* Row header */}
              <div
                className="flex items-center gap-3 px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => toggleExpand(i)}
              >
                {row.expanded
                  ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                  : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                }

                {/* DST field name */}
                <input
                  className="font-mono text-sm font-semibold text-gray-800 bg-transparent border-0 border-b border-dashed border-gray-300 focus:outline-none focus:border-brand-500 w-40"
                  placeholder="target_field"
                  value={row.dst}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => updateDst(i, e.target.value)}
                />

                {/* Summary */}
                <div className="flex-1 min-w-0 flex items-center gap-2 text-xs text-gray-400 truncate">
                  {row.rule.from?.length
                    ? <span className="font-mono truncate">from: [{row.rule.from.join(', ')}]</span>
                    : null
                  }
                  {row.rule.cases?.length
                    ? <span className="bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-medium">
                        {row.rule.cases.length} case{row.rule.cases.length !== 1 ? 's' : ''}
                      </span>
                    : null
                  }
                  {row.rule.default != null && row.rule.default !== ''
                    ? <span className="text-gray-400">default: "{row.rule.default}"</span>
                    : null
                  }
                </div>

                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeRow(i) }}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Row details */}
              {row.expanded && (
                <div className="px-4 py-4 space-y-4 bg-white border-t border-gray-200">
                  {/* From paths */}
                  <div>
                    <label className="text-xs font-semibold text-gray-600 block mb-1.5">
                      FROM  <span className="text-gray-400 font-normal">(flat-dict keys, tried in order)</span>
                    </label>
                    <div className="flex flex-wrap gap-2 items-center">
                      {(row.rule.from ?? []).map((path, pi) => (
                        <div key={pi} className="flex items-center gap-1">
                          <input
                            className="font-mono text-xs border border-gray-300 rounded px-2 py-1 w-36 focus:outline-none focus:ring-1 focus:ring-brand-500"
                            placeholder="event.name"
                            value={path}
                            onChange={(e) => {
                              const newFrom = [...(row.rule.from ?? [])]
                              newFrom[pi] = e.target.value
                              updateRule(i, { from: newFrom })
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const newFrom = (row.rule.from ?? []).filter((_, fi) => fi !== pi)
                              updateRule(i, { from: newFrom })
                            }}
                            className="text-gray-300 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => updateRule(i, { from: [...(row.rule.from ?? []), ''] })}
                        className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1 font-medium"
                      >
                        <Plus className="w-3 h-3" /> add fallback
                      </button>
                    </div>
                  </div>

                  {/* Cases */}
                  <div>
                    <label className="text-xs font-semibold text-gray-600 block mb-1.5">
                      CASES  <span className="text-gray-400 font-normal">(conditional overrides, evaluated in order)</span>
                    </label>
                    <RuleBuilder
                      cases={row.rule.cases ?? []}
                      onChange={(cases: DslCase[]) => updateRule(i, { cases })}
                    />
                  </div>

                  {/* Default + Transform + Type */}
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-gray-600 block mb-1.5">DEFAULT</label>
                      <Input
                        placeholder="unknown"
                        value={String(row.rule.default ?? '')}
                        onChange={(e) => updateRule(i, { default: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 block mb-1.5">TRANSFORM</label>
                      <select
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                        value={row.rule.transform ?? ''}
                        onChange={(e) => updateRule(i, { transform: (e.target.value || undefined) as DslRule['transform'] })}
                      >
                        {TRANSFORM_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 block mb-1.5">TYPE CAST</label>
                      <select
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                        value={row.rule.type ?? ''}
                        onChange={(e) => updateRule(i, { type: (e.target.value || undefined) as DslRule['type'] })}
                      >
                        {TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Required */}
                  <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer w-fit">
                    <input
                      type="checkbox"
                      className="rounded accent-brand-600"
                      checked={!!row.rule.required}
                      onChange={(e) => updateRule(i, { required: e.target.checked })}
                    />
                    Required (discard message if missing)
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>

        {rows.length > 0 && (
          <div className="mt-5 pt-4 border-t border-gray-100 flex items-center gap-3">
            <Button onClick={() => save()} loading={isPending}>
              <Save className="w-4 h-4" /> Save DSL Mapping
            </Button>
            <button
              type="button"
              className="text-xs text-gray-400 hover:text-gray-600 underline"
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? 'Hide' : 'Show'} JSON preview
            </button>
          </div>
        )}
      </Card>

      {/* JSON preview */}
      {showPreview && rows.length > 0 && (
        <Card title="DSL Preview" description="JSON that will be merged into uw:map:{source}">
          <pre className="text-xs font-mono bg-gray-900 text-emerald-400 p-4 rounded-lg overflow-auto max-h-72">
            {JSON.stringify({ dsl: rowsToDsl(rows) }, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  )
}
