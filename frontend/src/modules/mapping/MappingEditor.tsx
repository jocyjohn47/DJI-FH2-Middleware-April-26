import { useFieldArray, useForm, Controller } from 'react-hook-form'
import { useMutation, useQuery } from '@tanstack/react-query'
import { mappingService } from '@/services'
import { useUIStore } from '@/store'
import { Card } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Plus, Trash2, Play, AlertCircle, CheckCircle } from 'lucide-react'
import { useState } from 'react'
import type { MappingConfig, MappingRow } from '@/types'

const TYPE_OPTIONS = [
  { value: 'string', label: 'string' },
  { value: 'int',    label: 'int' },
  { value: 'float',  label: 'float' },
  { value: 'bool',   label: 'bool' },
  { value: 'json',   label: 'json' },
]

const DEFAULT_ROW: MappingRow = {
  src: '$.', dst: '', type: 'string', default: '', required: false,
}

const DEFAULT_MAPPING: MappingConfig = {
  mappings: [
    { src: '$.timestamp',  dst: 'timestamp',  type: 'string', default: '',       required: false },
    { src: '$.creator_id', dst: 'creator_id', type: 'string', default: 'system', required: true  },
    { src: '$.latitude',   dst: 'latitude',   type: 'float',  default: 0,        required: true  },
    { src: '$.longitude',  dst: 'longitude',  type: 'float',  default: 0,        required: true  },
    { src: '$.level',      dst: 'level',      type: 'string', default: 'info',   required: true  },
    { src: '$.description',dst: 'description',type: 'string', default: '',       required: false },
  ],
}

// ─── Preview helper ───────────────────────────────────────────────────────────
function tryApplyMapping(mappings: MappingRow[], sampleJson: string): Record<string, unknown> | string {
  try {
    const obj = JSON.parse(sampleJson) as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const row of mappings) {
      const path = row.src.replace(/^\$\./, '')
      const val = path ? (obj[path] ?? row.default) : row.default
      result[row.dst || '(unnamed)'] = val
    }
    return result
  } catch {
    return 'Invalid JSON'
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function MappingEditor({ sourceId }: { sourceId: string }) {
  const { addToast } = useUIStore()
  const [samplePayload, setSamplePayload] = useState(
    JSON.stringify({ timestamp: '2026-03-18T10:00:00Z', creator_id: 'pilot01', latitude: 22.54, longitude: 114.05, level: 'warning', description: 'obstacle' }, null, 2)
  )
  const [preview, setPreview] = useState<Record<string, unknown> | string | null>(null)

  // Load existing mapping
  const { isLoading } = useQuery({
    queryKey: ['mapping', sourceId],
    queryFn: () => mappingService.get(sourceId),
    enabled: !!sourceId,
    onSuccess: (data: MappingConfig) => {
      if (data.mappings.length > 0) reset(data)
      else reset(DEFAULT_MAPPING)
    },
  } as Parameters<typeof useQuery>[0])

  const { control, register, handleSubmit, reset, getValues, formState: { errors } } =
    useForm<MappingConfig>({ defaultValues: DEFAULT_MAPPING })

  const { fields, append, remove } = useFieldArray({ control, name: 'mappings' })

  const { mutate, isPending } = useMutation({
    mutationFn: (cfg: MappingConfig) => mappingService.set(sourceId, cfg),
    onSuccess: () => addToast('success', 'Mapping saved'),
    onError: (e: Error) => addToast('error', e.message),
  })

  const handlePreview = () => {
    const result = tryApplyMapping(getValues('mappings'), samplePayload)
    setPreview(result)
  }

  if (isLoading) return <div className="text-sm text-gray-400">Loading mapping…</div>

  return (
    <div className="space-y-4">
      <Card
        title="Field Mapping"
        description="JSONPath rules to transform incoming webhook_event into unified fields"
        actions={
          <Button variant="secondary" size="sm" onClick={() => append({ ...DEFAULT_ROW })}>
            <Plus className="w-3.5 h-3.5" /> Add Row
          </Button>
        }
      >
        <form onSubmit={handleSubmit((d) => mutate(d))}>
          {/* Header row */}
          <div className="grid grid-cols-[2fr_2fr_1fr_1fr_auto_auto] gap-2 mb-2 px-1">
            {['JSONPath (src)', 'Field (dst)', 'Type', 'Default', 'Req', ''].map((h) => (
              <span key={h} className="text-xs font-medium text-gray-500">{h}</span>
            ))}
          </div>

          {/* Mapping rows */}
          <div className="space-y-2">
            {fields.map((field, i) => (
              <div key={field.id} className="grid grid-cols-[2fr_2fr_1fr_1fr_auto_auto] gap-2 items-start">
                <Input
                  placeholder="$.field_name"
                  error={errors.mappings?.[i]?.src?.message}
                  {...register(`mappings.${i}.src`, {
                    required: 'Required',
                    pattern: { value: /^\$\./, message: 'Must start with $.' },
                  })}
                />
                <Input
                  placeholder="unified_field"
                  error={errors.mappings?.[i]?.dst?.message}
                  {...register(`mappings.${i}.dst`, { required: 'Required' })}
                />
                <Controller
                  control={control}
                  name={`mappings.${i}.type`}
                  render={({ field: f }) => (
                    <Select
                      options={TYPE_OPTIONS}
                      value={f.value}
                      onChange={f.onChange}
                    />
                  )}
                />
                <Input placeholder="default" {...register(`mappings.${i}.default`)} />
                <div className="flex items-center justify-center h-9">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded accent-brand-600"
                    {...register(`mappings.${i}.required`)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="flex items-center justify-center h-9 w-9 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-3 mt-5 pt-4 border-t border-gray-100">
            <Button type="submit" loading={isPending}>Save Mapping</Button>
            <Button type="button" variant="secondary" onClick={handlePreview}>
              <Play className="w-4 h-4" /> Preview
            </Button>
          </div>
        </form>
      </Card>

      {/* Sample payload + preview */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="Sample Payload" description="Paste a sample webhook_event to test mapping">
          <textarea
            className="w-full font-mono text-xs border border-gray-300 rounded-lg p-3 h-48 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={samplePayload}
            onChange={(e) => { setSamplePayload(e.target.value); setPreview(null) }}
          />
        </Card>

        <Card title="Preview Result">
          {!preview ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">
              Click Preview to test your mapping
            </div>
          ) : typeof preview === 'string' ? (
            <div className="flex items-center gap-2 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4" /> {preview}
            </div>
          ) : (
            <div className="h-48 overflow-y-auto">
              <pre className="text-xs font-mono bg-gray-900 text-emerald-400 p-3 rounded-lg h-full overflow-auto">
                {JSON.stringify(preview, null, 2)}
              </pre>
              <div className="flex items-center gap-1 mt-2 text-emerald-600 text-xs">
                <CheckCircle className="w-3.5 h-3.5" /> Mapping valid
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
