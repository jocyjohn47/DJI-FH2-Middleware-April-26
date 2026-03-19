/**
 * FH2ConfigPanel.tsx  —  Top config panel (compact)
 * Quick-set: workflow_uuid, X-User-Token, x-project-uuid, creator
 * Reads/writes via /admin/flighthub/get|set
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Save, ChevronDown, ChevronRight, Wand2 } from 'lucide-react'
import { egressService, tokenService } from '@/services'
import { useUIStore } from '@/store'
import type { EgressConfig } from '@/types'

const DEFAULT_ENDPOINT = 'https://es-flight-api-us.djigate.com/openapi/v0.1/workflow'

interface FH2State {
  endpoint: string
  userToken: string
  projectUuid: string
  workflowUuid: string
  rawPaste: string
}

function TokenInput({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  const masked = value.includes('****')
  return (
    <div>
      <label className="text-xs font-medium text-gray-600 block mb-1">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full text-xs font-mono border border-gray-300 rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
      {masked && (
        <p className="text-xs text-amber-600 mt-0.5">Masked — enter new value to update</p>
      )}
    </div>
  )
}

interface FH2ConfigPanelProps {
  sourceId: string
}

export function FH2ConfigPanel({ sourceId }: FH2ConfigPanelProps) {
  const { addToast } = useUIStore()
  const qc = useQueryClient()
  const [open, setOpen] = useState(true)
  const [state, setState] = useState<FH2State>({
    endpoint: DEFAULT_ENDPOINT,
    userToken: '',
    projectUuid: '',
    workflowUuid: '',
    rawPaste: '',
  })
  const [showExtractor, setShowExtractor] = useState(false)

  const set = (patch: Partial<FH2State>) =>
    setState((prev) => ({ ...prev, ...patch }))

  // Load
  useQuery({
    queryKey: ['egress', sourceId],
    queryFn: () => egressService.get(sourceId),
    enabled: !!sourceId,
    onSuccess: (cfg: EgressConfig) => {
      setState({
        endpoint:    cfg.endpoint ?? DEFAULT_ENDPOINT,
        userToken:   cfg.headers?.['X-User-Token'] ?? '',
        projectUuid: cfg.headers?.['x-project-uuid'] ?? '',
        workflowUuid: (cfg.template_body?.['workflow_uuid'] as string) ?? '',
        rawPaste: '',
      })
    },
  } as Parameters<typeof useQuery>[0])

  // Save
  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      // Preserve existing template_body structure, only update credentials
      const existing = await egressService.get(sourceId).catch(() => null)
      const cfg: EgressConfig = {
        endpoint: state.endpoint || DEFAULT_ENDPOINT,
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': state.userToken,
          'x-project-uuid': state.projectUuid,
        },
        template_body: {
          ...(existing?.template_body ?? {}),
          workflow_uuid: state.workflowUuid,
        },
        retry_policy: existing?.retry_policy ?? { max_retries: 3, backoff: 'exponential' },
      }
      return egressService.set(sourceId, cfg)
    },
    onSuccess: () => {
      addToast('success', 'FH2 credentials saved')
      qc.invalidateQueries({ queryKey: ['egress', sourceId] })
    },
    onError: (e: Error) => addToast('error', e.message),
  })

  // Token extractor
  const { mutate: extract, isPending: extracting } = useMutation({
    mutationFn: () => tokenService.extract(state.rawPaste),
    onSuccess: (extracted) => {
      const patch: Partial<FH2State> = {}
      if (extracted['X-User-Token'])   patch.userToken    = extracted['X-User-Token']
      if (extracted['x-project-uuid']) patch.projectUuid  = extracted['x-project-uuid']
      if (extracted['workflow_uuid'])  patch.workflowUuid = extracted['workflow_uuid']
      set(patch)
      addToast('success', `Extracted: ${Object.keys(patch).join(', ')}`)
    },
    onError: (e: Error) => addToast('error', e.message),
  })

  return (
    <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
      {/* Header toggle */}
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          <span className="text-sm font-semibold text-gray-700">FlightHub2 Credentials</span>
          {state.workflowUuid && (
            <span className="text-xs text-gray-400 font-mono truncate max-w-40">
              {state.workflowUuid}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400">{sourceId}</span>
      </button>

      {open && (
        <div className="p-4 space-y-3">
          {/* 4 fields in 2x2 grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">workflow_uuid</label>
              <input
                className="w-full text-xs font-mono border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="FH2 workflow UUID"
                value={state.workflowUuid}
                onChange={(e) => set({ workflowUuid: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">API Endpoint</label>
              <input
                className="w-full text-xs font-mono border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                value={state.endpoint}
                onChange={(e) => set({ endpoint: e.target.value })}
              />
            </div>
            <TokenInput
              label="X-User-Token"
              value={state.userToken}
              onChange={(v) => set({ userToken: v })}
              placeholder="FlightHub2 user token"
            />
            <TokenInput
              label="x-project-uuid"
              value={state.projectUuid}
              onChange={(v) => set({ projectUuid: v })}
              placeholder="FlightHub2 project UUID"
            />
          </div>

          {/* Actions row */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => save()}
              disabled={isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              {isPending ? 'Saving…' : 'Save Credentials'}
            </button>
            <button
              type="button"
              onClick={() => setShowExtractor(!showExtractor)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              <Wand2 className="w-3.5 h-3.5" />
              Token Extractor
            </button>
          </div>

          {/* Token extractor (collapsible) */}
          {showExtractor && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
              <p className="text-xs text-amber-700 font-medium">
                Paste raw headers / curl / JSON — auto-extract tokens
              </p>
              <textarea
                className="w-full text-xs font-mono border border-amber-300 rounded-lg p-2 h-20 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                placeholder={'X-User-Token: xxx\nx-project-uuid: yyy\nworkflow_uuid=zzz'}
                value={state.rawPaste}
                onChange={(e) => set({ rawPaste: e.target.value })}
              />
              <button
                type="button"
                onClick={() => extract()}
                disabled={extracting || !state.rawPaste.trim()}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                <Wand2 className="w-3 h-3" />
                {extracting ? 'Extracting…' : 'Extract & Apply'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
