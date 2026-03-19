/**
 * FieldList.tsx  —  Left panel
 * Shows normalized input fields from debug run.
 * Highlights which fields are already mapped.
 */
import { Search } from 'lucide-react'
import { useState } from 'react'
import { useMappingStore } from '@/store'

interface FieldListProps {
  fields: string[]
  selectedField: string | null
  onSelect: (f: string) => void
}

export function FieldList({ fields, selectedField, onSelect }: FieldListProps) {
  const { mapping } = useMappingStore()
  const [search, setSearch] = useState('')

  const filtered = fields.filter((f) =>
    f.toLowerCase().includes(search.toLowerCase())
  )

  const mapped = new Set(Object.keys(mapping))

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        <input
          className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
          placeholder="Filter fields…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Field list */}
      <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0">
        {filtered.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-4">
            {fields.length === 0
              ? 'Run debug to load fields'
              : 'No matching fields'}
          </p>
        )}
        {filtered.map((f) => {
          const isMapped = mapped.has(f)
          const isSelected = f === selectedField

          return (
            <button
              key={f}
              type="button"
              onClick={() => onSelect(f)}
              className={[
                'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors flex items-center justify-between gap-2',
                isSelected
                  ? 'bg-brand-600 text-white'
                  : isMapped
                  ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'text-gray-700 hover:bg-gray-100',
              ].join(' ')}
            >
              <span className="truncate">{f}</span>
              {isMapped && !isSelected && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              )}
            </button>
          )
        })}
      </div>

      {/* Stats */}
      <div className="pt-2 mt-2 border-t border-gray-100 text-xs text-gray-400 flex justify-between">
        <span>{fields.length} fields</span>
        <span className="text-emerald-600">{mapped.size} mapped</span>
      </div>
    </div>
  )
}
