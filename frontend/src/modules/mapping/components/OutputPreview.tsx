/**
 * OutputPreview.tsx  —  Right panel
 * Live FH2 JSON preview, computed from mapping + normalized fields.
 */
import { Copy, CheckCheck } from 'lucide-react'
import { useState } from 'react'
import { useMappingStore } from '@/store'
import type { FH2Body } from '@/types'

// ─── Syntax highlight helper (simple) ────────────────────────────────────────
function highlight(json: string): string {
  return json
    .replace(/(".*?")\s*:/g, '<span class="text-blue-300">$1</span>:')
    .replace(/:\s*(".*?")/g, ': <span class="text-emerald-300">$1</span>')
    .replace(/:\s*(\d+\.?\d*)/g, ': <span class="text-amber-300">$1</span>')
    .replace(/:\s*(true|false|null)/g, ': <span class="text-purple-300">$1</span>')
}

interface OutputPreviewProps {
  /** If provided, show this body (from debug run). Otherwise show store preview. */
  body?: FH2Body | null
}

export function OutputPreview({ body: externalBody }: OutputPreviewProps) {
  const { preview: storePreview } = useMappingStore()
  const [copied, setCopied] = useState(false)

  const body = externalBody ?? storePreview

  const json = body
    ? JSON.stringify(body, null, 2)
    : JSON.stringify({
        workflow_uuid: '…',
        trigger_type: 0,
        name: '…',
        params: {
          creator: '…',
          latitude: null,
          longitude: null,
          level: 3,
          desc: '…',
        },
      }, null, 2)

  const handleCopy = () => {
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          FH2 Request Body
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
        >
          {copied
            ? <><CheckCheck className="w-3.5 h-3.5 text-emerald-500" /> Copied</>
            : <><Copy className="w-3.5 h-3.5" /> Copy</>
          }
        </button>
      </div>

      {/* JSON */}
      <div className="flex-1 min-h-0 overflow-auto rounded-xl bg-gray-900 p-4">
        {body ? (
          <pre
            className="text-xs font-mono leading-relaxed"
            dangerouslySetInnerHTML={{ __html: highlight(json) }}
          />
        ) : (
          <pre className="text-xs font-mono text-gray-600 leading-relaxed">
            {json}
          </pre>
        )}
      </div>

      {/* Status */}
      <div className="pt-2 mt-2 border-t border-gray-100">
        {body ? (
          <span className="text-xs text-emerald-600 font-medium">
            ✓ Preview ready
          </span>
        ) : (
          <span className="text-xs text-gray-400">
            Map fields and run preview to see output
          </span>
        )}
      </div>
    </div>
  )
}
