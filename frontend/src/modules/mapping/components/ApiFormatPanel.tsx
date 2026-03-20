/**
 * ApiFormatPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Shows the expected FlightHub2 API request format in a compact, collapsible
 * panel. Embedded in MappingBoard below the 3-column mapping grid.
 *
 * Includes:
 *  - Full JSON body schema with field types and required flags
 *  - HTTP header requirements (X-User-Token, x-project-uuid)
 *  - Field description table
 */
import { useState } from 'react'
import { ChevronDown, ChevronRight, Code2, Copy } from 'lucide-react'
import { useUIStore } from '@/store'

const EXAMPLE_BODY = {
  workflow_uuid: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  trigger_type: 0,
  name: "Alert-1712345678",
  params: {
    creator: "pilot01",
    latitude: 22.543096,
    longitude: 114.057865,
    level: 3,
    desc: "Obstacle detected near building A",
  },
}

const FIELD_DEFS = [
  { path: 'workflow_uuid',      type: 'string',  req: true,  note: 'FH2 Workflow UUID — configure in Credentials panel' },
  { path: 'trigger_type',       type: 'int',     req: true,  note: 'Trigger type, default = 0' },
  { path: 'name',               type: 'string',  req: false, note: 'Event name, default = "FlightHub2-Event"' },
  { path: 'params.creator',     type: 'string',  req: false, note: 'Creator/operator identifier, default = "system"' },
  { path: 'params.latitude',    type: 'float',   req: true,  note: 'WGS-84 latitude; auto-fills from device GPS if mapped' },
  { path: 'params.longitude',   type: 'float',   req: true,  note: 'WGS-84 longitude; auto-fills from device GPS if mapped' },
  { path: 'params.level',       type: 'int 1–5', req: false, note: 'Severity level, default = 3 (warning)' },
  { path: 'params.desc',        type: 'string',  req: false, note: 'Event description / message, default = ""' },
]

const HEADER_DEFS = [
  { header: 'Content-Type',   value: 'application/json',  note: 'Always required' },
  { header: 'X-User-Token',   value: '<FH2 user token>',  note: 'Configure in Credentials panel' },
  { header: 'x-project-uuid', value: '<FH2 project UUID>',note: 'Configure in Credentials panel' },
]

export function ApiFormatPanel() {
  const { addToast } = useUIStore()
  const [open, setOpen] = useState(true)  // default open so users can see the format

  const bodyStr = JSON.stringify(EXAMPLE_BODY, null, 2)

  const copyExample = () => {
    navigator.clipboard.writeText(bodyStr)
    addToast('info', 'Example body copied')
  }

  return (
    <div className="border border-indigo-200 rounded-xl bg-white overflow-hidden">
      {/* Header */}
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 bg-indigo-50 hover:bg-indigo-100 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          {open
            ? <ChevronDown className="w-4 h-4 text-indigo-400" />
            : <ChevronRight className="w-4 h-4 text-indigo-400" />}
          <Code2 className="w-4 h-4 text-indigo-500" />
          <span className="text-sm font-semibold text-indigo-700">FlightHub2 API Body Format</span>
          <span className="text-xs text-indigo-400">— POST /openapi/v0.1/workflow</span>
        </div>
        <span className="text-xs text-indigo-400">click to {open ? 'collapse' : 'expand'}</span>
      </button>

      {open && (
        <div className="p-4 space-y-4">

          {/* HTTP Headers */}
          <div>
            <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              Required HTTP Headers
            </h4>
            <div className="rounded-lg border border-gray-200 overflow-hidden text-xs">
              <div className="grid grid-cols-[180px_200px_1fr] bg-gray-50 px-3 py-1.5 font-semibold text-gray-500">
                <span>Header</span>
                <span>Value</span>
                <span>Note</span>
              </div>
              {HEADER_DEFS.map((h) => (
                <div key={h.header} className="grid grid-cols-[180px_200px_1fr] px-3 py-1.5 border-t border-gray-100 hover:bg-gray-50">
                  <code className="font-mono text-gray-800">{h.header}</code>
                  <code className="font-mono text-blue-600">{h.value}</code>
                  <span className="text-gray-500">{h.note}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Field definitions */}
          <div>
            <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              Request Body Fields
            </h4>
            <div className="rounded-lg border border-gray-200 overflow-hidden text-xs">
              <div className="grid grid-cols-[200px_80px_60px_1fr] bg-gray-50 px-3 py-1.5 font-semibold text-gray-500">
                <span>Field Path</span>
                <span>Type</span>
                <span>Req</span>
                <span>Description</span>
              </div>
              {FIELD_DEFS.map((f) => (
                <div key={f.path} className="grid grid-cols-[200px_80px_60px_1fr] px-3 py-1.5 border-t border-gray-100 hover:bg-gray-50">
                  <code className="font-mono text-gray-800">{f.path}</code>
                  <span className="text-purple-600 font-mono">{f.type}</span>
                  <span className={f.req ? 'text-red-500 font-semibold' : 'text-gray-400'}>
                    {f.req ? '✓ Yes' : 'No'}
                  </span>
                  <span className="text-gray-500">{f.note}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Example JSON */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Example Request Body
              </h4>
              <button
                type="button"
                onClick={copyExample}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                <Copy className="w-3 h-3" />
                Copy
              </button>
            </div>
            <pre className="bg-gray-900 text-green-400 text-xs font-mono rounded-lg p-3 overflow-x-auto leading-relaxed">
              {bodyStr}
            </pre>
          </div>

          {/* Autofill note */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
            <strong>Autofill priority:</strong> Mapped fields → Alias fields (e.g. "lat" → params.latitude) →
            Device GPS from registry → Configured defaults → Hardcoded defaults
            (level=3, creator="system", trigger_type=0)
          </div>
        </div>
      )}
    </div>
  )
}
