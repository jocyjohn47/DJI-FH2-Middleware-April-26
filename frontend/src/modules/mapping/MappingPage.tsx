import { useState } from 'react'
import { useSourceStore } from '@/store'
import { Card } from '@/components/ui/Card'
import { SourceSelector } from '@/modules/source/SourceForm'
import { MappingEditor } from '@/modules/mapping/MappingEditor'
import { DslEditor } from '@/modules/mapping/DslEditor'
import { DebugPanel } from '@/components/mapping/DebugPanel'

type Tab = 'legacy' | 'dsl' | 'debug'

export default function MappingPage() {
  const { selected } = useSourceStore()
  const [tab, setTab] = useState<Tab>('legacy')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Field Mapping</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure how incoming webhook fields are mapped to unified fields used by templates.
        </p>
      </div>

      <Card title="Select Source"><SourceSelector /></Card>

      {selected ? (
        <>
          {/* Tab bar */}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
            {([
              ['legacy', 'JSONPath (Classic)'],
              ['dsl',    'DSL (Advanced)'],
              ['debug',  '🔍 Debug Pipeline'],
            ] as [Tab, string][]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 'legacy' && <MappingEditor sourceId={selected} />}
          {tab === 'dsl'    && <DslEditor sourceId={selected} />}
          {tab === 'debug'  && <DebugPanel defaultSource={selected} />}
        </>
      ) : (
        <p className="text-sm text-gray-400">Select a source above to edit its mapping.</p>
      )}
    </div>
  )
}
