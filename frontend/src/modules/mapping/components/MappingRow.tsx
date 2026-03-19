/**
 * MappingRow.tsx  —  Center panel row
 * source_field  →  [target dropdown]
 * Features: auto-suggest on mount, clear button, drag handle (optional)
 */
import { X, Sparkles } from 'lucide-react'
import { useMappingStore } from '@/store'
import type { FH2TargetField } from '@/types'

// ─── FH2 target fields catalog ────────────────────────────────────────────────
export const FH2_TARGET_FIELDS: FH2TargetField[] = [
  { path: 'name',              label: 'name',              type: 'string', required: true,  description: 'Workflow trigger name' },
  { path: 'trigger_type',      label: 'trigger_type',      type: 'int',    required: true,  description: 'Trigger type (default 0)' },
  { path: 'workflow_uuid',     label: 'workflow_uuid',     type: 'string', required: true,  description: 'FH2 workflow UUID' },
  { path: 'params.creator',    label: 'params.creator',    type: 'string', required: true,  description: 'Operator / creator ID' },
  { path: 'params.latitude',   label: 'params.latitude',   type: 'number', required: true,  description: 'GPS latitude' },
  { path: 'params.longitude',  label: 'params.longitude',  type: 'number', required: true,  description: 'GPS longitude' },
  { path: 'params.level',      label: 'params.level',      type: 'int',    required: true,  description: 'Alert level (1-5)' },
  { path: 'params.desc',       label: 'params.desc',       type: 'string', required: false, description: 'Description / message' },
]

// Simple name similarity for auto-suggest
function suggestTarget(src: string): string {
  const s = src.toLowerCase()
  if (s.includes('lat'))        return 'params.latitude'
  if (s.includes('lon') || s.includes('lng')) return 'params.longitude'
  if (s.includes('level') || s.includes('severity')) return 'params.level'
  if (s.includes('desc') || s.includes('message') || s.includes('msg')) return 'params.desc'
  if (s.includes('creator') || s.includes('operator') || s.includes('pilot')) return 'params.creator'
  if (s.includes('name') || s.includes('title') || s.includes('event')) return 'name'
  if (s.includes('workflow')) return 'workflow_uuid'
  return ''
}

interface MappingRowProps {
  srcField: string
  /** already-mapped target (or '') */
  targetField: string
}

export function MappingRow({ srcField, targetField }: MappingRowProps) {
  const { setMappingField, clearMappingField } = useMappingStore()
  const suggested = suggestTarget(srcField)
  const isEmpty = !targetField

  return (
    <div className={[
      'flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors',
      isEmpty
        ? 'border-gray-200 bg-white'
        : 'border-emerald-200 bg-emerald-50',
    ].join(' ')}>
      {/* Source field badge */}
      <div className="flex-1 min-w-0">
        <span className="font-mono text-xs text-gray-800 bg-gray-100 px-2 py-1 rounded-md truncate block">
          {srcField}
        </span>
      </div>

      {/* Arrow */}
      <span className="text-gray-300 text-sm select-none shrink-0">→</span>

      {/* Target dropdown */}
      <div className="flex items-center gap-1 w-48 shrink-0">
        <select
          className={[
            'flex-1 text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white',
            isEmpty ? 'border-gray-300 text-gray-500' : 'border-emerald-400 text-emerald-800 font-medium',
          ].join(' ')}
          value={targetField}
          onChange={(e) => {
            if (e.target.value) setMappingField(srcField, e.target.value)
            else clearMappingField(srcField)
          }}
        >
          <option value="">— select —</option>
          {FH2_TARGET_FIELDS.map((t) => (
            <option key={t.path} value={t.path}>
              {t.label}{t.required ? ' *' : ''}
            </option>
          ))}
        </select>

        {/* Auto-suggest button */}
        {isEmpty && suggested && (
          <button
            type="button"
            title={`Auto-suggest: ${suggested}`}
            onClick={() => setMappingField(srcField, suggested)}
            className="w-6 h-6 flex items-center justify-center rounded text-amber-500 hover:bg-amber-50 transition-colors shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Clear button */}
        {!isEmpty && (
          <button
            type="button"
            onClick={() => clearMappingField(srcField)}
            className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
