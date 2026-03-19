/**
 * RuleBuilder.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Reusable component for building DSL "cases" rules.
 *
 * Output shape (per rule):
 *   { if: "$.field == 'value'", then: "result" }
 */
import { Plus, Trash2 } from 'lucide-react'
import type { DslCase } from '@/types'

const OPERATORS = ['==', '!=', '>', '<', '>=', '<=']

interface RuleBuilderProps {
  cases: DslCase[]
  onChange: (cases: DslCase[]) => void
}

export function RuleBuilder({ cases, onChange }: RuleBuilderProps) {
  const addCase = () =>
    onChange([...cases, { if: "$.event.name == 'value'", then: '' }])

  const removeCase = (i: number) =>
    onChange(cases.filter((_, idx) => idx !== i))

  const updateCase = (i: number, field: 'if' | 'then', val: string) =>
    onChange(cases.map((c, idx) =>
      idx === i ? { ...c, [field]: val } : c
    ))

  // Parse/compose the "if" string components
  const parseIf = (expr: string) => {
    const m = expr.match(/^\$\.(\S+)\s*(==|!=|>=|<=|>|<)\s*['"]?(.+?)['"]?$/)
    if (!m) return { field: '', op: '==', value: '' }
    return { field: m[1], op: m[2], value: m[3] }
  }

  const composeIf = (field: string, op: string, value: string) => {
    if (!field) return ''
    const needsQuote = !/^-?\d/.test(value) && value !== 'true' && value !== 'false'
    return `$.${field} ${op} ${needsQuote ? `'${value}'` : value}`
  }

  return (
    <div className="space-y-2">
      {cases.length === 0 && (
        <p className="text-xs text-gray-400 italic">No cases — click Add to build conditional overrides.</p>
      )}

      {cases.map((c, i) => {
        const { field, op, value } = parseIf(c.if)
        return (
          <div key={i} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <span className="text-xs text-gray-400 font-medium w-5 shrink-0">IF</span>

            {/* Field */}
            <input
              className="w-28 text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="event.name"
              value={field}
              onChange={(e) =>
                updateCase(i, 'if', composeIf(e.target.value, op, value))
              }
            />

            {/* Operator */}
            <select
              className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
              value={op}
              onChange={(e) =>
                updateCase(i, 'if', composeIf(field, e.target.value, value))
              }
            >
              {OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>

            {/* Value */}
            <input
              className="w-24 text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="VMD"
              value={value}
              onChange={(e) =>
                updateCase(i, 'if', composeIf(field, op, e.target.value))
              }
            />

            <span className="text-xs text-gray-400 font-medium shrink-0">→</span>

            {/* Then */}
            <input
              className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="motion"
              value={String(c.then)}
              onChange={(e) => updateCase(i, 'then', e.target.value)}
            />

            <button
              type="button"
              onClick={() => removeCase(i)}
              className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      })}

      <button
        type="button"
        onClick={addCase}
        className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium transition-colors"
      >
        <Plus className="w-3.5 h-3.5" /> Add case
      </button>
    </div>
  )
}
