import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Save, Info } from 'lucide-react'
import { adapterService, sourceService } from '@/services'
import { useSourceStore, useUIStore } from '@/store'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import type { AdapterConfig } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdapterRow {
  target: string          // normalized key
  paths: string           // comma-separated candidate paths
}

function configToRows(cfg: AdapterConfig): AdapterRow[] {
  return Object.entries(cfg.fields ?? {}).map(([target, paths]) => ({
    target,
    paths: paths.join(', '),
  }))
}

function rowsToConfig(rows: AdapterRow[]): AdapterConfig {
  const fields: Record<string, string[]> = {}
  for (const row of rows) {
    const t = row.target.trim()
    if (!t) continue
    fields[t] = row.paths
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
  }
  return { fields }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdapterPage() {
  const { selected, setSelected } = useSourceStore()
  const { addToast } = useUIStore()
  const qc = useQueryClient()

  const [rows, setRows] = useState<AdapterRow[]>([])

  // Load source list
  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: sourceService.list,
  })

  // Load adapter config when source selected
  useQuery({
    queryKey: ['adapter', selected],
    queryFn: () => adapterService.get(selected),
    enabled: !!selected,
    onSuccess: (cfg: AdapterConfig) => {
      const r = configToRows(cfg)
      setRows(r.length ? r : [])
    },
  } as Parameters<typeof useQuery>[0])

  // Save mutation
  const { mutate: save, isPending } = useMutation({
    mutationFn: (cfg: AdapterConfig) => adapterService.set(selected, cfg),
    onSuccess: () => {
      addToast('success', 'Adapter config saved')
      qc.invalidateQueries({ queryKey: ['adapter', selected] })
    },
    onError: (e: Error) => addToast('error', e.message),
  })

  const handleSave = () => save(rowsToConfig(rows))

  const addRow = () => setRows((prev) => [...prev, { target: '', paths: '' }])

  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i))

  const updateRow = (i: number, key: keyof AdapterRow, val: string) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Adapter</h1>
        <p className="text-sm text-gray-500 mt-1">
          Normalize incoming field names before mapping. Each row maps a canonical key to one or more
          source paths tried in order.
        </p>
      </div>

      {/* Source selector */}
      <Card title="Source">
        <div className="flex items-center gap-3">
          <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">— select source —</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {selected && (
            <span className="text-xs text-gray-400 font-mono">uw:adapter:{selected}</span>
          )}
        </div>
      </Card>

      {/* Field table */}
      {selected && (
        <Card
          title="Field Normalization Rules"
          description="Define canonical target fields and their source path fallback chain."
          actions={
            <Button variant="secondary" size="sm" onClick={addRow}>
              <Plus className="w-3.5 h-3.5" /> Add Row
            </Button>
          }
        >
          {/* Info banner */}
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-4 text-xs text-blue-700">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Paths are tried left-to-right. Use dot-notation matching the flattened JSON keys
              (e.g. <code className="font-mono">Event.Source.Id</code>). Separate multiple paths with commas.
            </span>
          </div>

          {/* Table header */}
          <div className="grid grid-cols-[2fr_3fr_auto] gap-3 mb-2 px-1">
            {['Target Field', 'Source Paths (comma-separated, priority order)', ''].map((h) => (
              <span key={h} className="text-xs font-medium text-gray-500">{h}</span>
            ))}
          </div>

          {/* Rows */}
          <div className="space-y-2">
            {rows.length === 0 && (
              <div className="text-sm text-gray-400 py-6 text-center">
                No rules yet — click "Add Row" to start.
              </div>
            )}
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-[2fr_3fr_auto] gap-3 items-start">
                <Input
                  placeholder="event.name"
                  value={row.target}
                  onChange={(e) => updateRow(i, 'target', e.target.value)}
                />
                <Input
                  placeholder="Event.Name, eventType, type"
                  value={row.paths}
                  onChange={(e) => updateRow(i, 'paths', e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="flex items-center justify-center h-9 w-9 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {rows.length > 0 && (
            <div className="mt-5 pt-4 border-t border-gray-100 flex items-center gap-3">
              <Button onClick={handleSave} loading={isPending}>
                <Save className="w-4 h-4" /> Save Adapter
              </Button>
              <span className="text-xs text-gray-400">{rows.length} rule{rows.length !== 1 ? 's' : ''}</span>
            </div>
          )}
        </Card>
      )}

      {/* Preview JSON */}
      {selected && rows.length > 0 && (
        <Card title="Config Preview" description="JSON stored at uw:adapter:{source}">
          <pre className="text-xs font-mono bg-gray-900 text-emerald-400 p-4 rounded-lg overflow-auto max-h-64">
            {JSON.stringify(rowsToConfig(rows), null, 2)}
          </pre>
        </Card>
      )}

      {/* Example */}
      {!selected && (
        <Card title="Example Config">
          <pre className="text-xs font-mono bg-gray-900 text-blue-300 p-4 rounded-lg overflow-auto">
{`{
  "fields": {
    "event.name":  ["Event.Name", "eventType", "type"],
    "device.id":   ["Event.Source.Id", "deviceId", "device_id"],
    "event.level": ["Event.Level", "severity", "level"]
  }
}`}
          </pre>
        </Card>
      )}
    </div>
  )
}
