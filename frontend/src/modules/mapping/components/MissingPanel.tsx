/**
 * MissingPanel.tsx  —  Below preview
 * Shows required FH2 body paths that are unmapped/unfilled.
 * Also explains autofill fallback logic.
 */
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { useMappingStore } from '@/store'
import { FH2_TARGET_FIELDS } from './MappingRow'

const AUTOFILL_NOTES: Record<string, string> = {
  'params.latitude':  'Will use device GPS if device_id is mapped',
  'params.longitude': 'Will use device GPS if device_id is mapped',
  'params.level':     'Default = 3 (warning)',
  'params.creator':   'Default = "system"',
  'workflow_uuid':    'Set in Egress config',
  'trigger_type':     'Default = 0',
}

interface MissingPanelProps {
  missing?: string[]
}

export function MissingPanel({ missing: externalMissing }: MissingPanelProps) {
  const { missing: storeMissing, mapping } = useMappingStore()
  const missing = externalMissing ?? storeMissing

  const required = FH2_TARGET_FIELDS.filter((f) => f.required)
  const mappedTargets = new Set(Object.values(mapping))

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        {missing.length === 0 ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-amber-500" />
        )}
        <span className="text-sm font-semibold text-gray-700">
          {missing.length === 0
            ? 'All required fields covered'
            : `${missing.length} field${missing.length !== 1 ? 's' : ''} may be missing`}
        </span>
      </div>

      {/* Required field checklist */}
      <div className="space-y-1.5">
        {required.map((f) => {
          const isMapped = mappedTargets.has(f.path)
          const isMissing = missing.includes(f.path)
          const note = AUTOFILL_NOTES[f.path]

          return (
            <div
              key={f.path}
              className={[
                'flex items-start gap-2 px-3 py-2 rounded-lg text-xs border',
                isMissing
                  ? 'bg-amber-50 border-amber-200'
                  : isMapped
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-gray-50 border-gray-200',
              ].join(' ')}
            >
              <span className="mt-0.5 shrink-0">
                {isMapped
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  : isMissing
                  ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  : <Info className="w-3.5 h-3.5 text-gray-400" />
                }
              </span>
              <div className="flex-1 min-w-0">
                <span className={`font-mono font-semibold ${isMissing ? 'text-amber-700' : isMapped ? 'text-emerald-700' : 'text-gray-600'}`}>
                  {f.path}
                </span>
                {note && !isMapped && (
                  <span className="block text-gray-400 mt-0.5">{note}</span>
                )}
                {f.description && (
                  <span className="block text-gray-400 mt-0.5">{f.description}</span>
                )}
              </div>
              {isMapped && (
                <span className="text-emerald-600 font-medium shrink-0">✓ mapped</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
