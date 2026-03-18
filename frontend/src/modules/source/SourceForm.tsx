import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sourceService, authService } from '@/services'
import { useUIStore, useSourceStore } from '@/store'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Copy, RefreshCw, Eye, EyeOff } from 'lucide-react'
import type { IngressAuth } from '@/types'

// ─── Create Source ────────────────────────────────────────────────────────────
interface CreateForm { sourceId: string }

export function SourceCreateForm({ onCreated }: { onCreated?: (id: string) => void }) {
  const qc = useQueryClient()
  const { addToast } = useUIStore()
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateForm>()

  const { mutate, isPending } = useMutation({
    mutationFn: (id: string) => sourceService.init(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      addToast('success', `Source "${id}" created`)
      reset()
      onCreated?.(id)
    },
    onError: (e: Error) => addToast('error', e.message),
  })

  return (
    <Card title="Create Source" description="A source is a named webhook entry point">
      <form
        onSubmit={handleSubmit((d) => mutate(d.sourceId))}
        className="flex gap-3 items-end"
      >
        <div className="flex-1">
          <Input
            label="Source ID"
            placeholder="e.g. flighthub2"
            error={errors.sourceId?.message}
            {...register('sourceId', {
              required: 'Required',
              pattern: { value: /^[a-z0-9_-]+$/, message: 'lowercase, numbers, _ - only' },
            })}
          />
        </div>
        <Button type="submit" loading={isPending}>Create Source</Button>
      </form>
    </Card>
  )
}

// ─── Ingress Auth Config ──────────────────────────────────────────────────────
function generateToken(len = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

interface AuthFormFields {
  enabled: boolean
  header_name: string
  token: string
}

export function SourceAuthForm({ sourceId }: { sourceId: string }) {
  const { addToast } = useUIStore()
  const [showToken, setShowToken] = useState(false)
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<AuthFormFields>({
    defaultValues: { enabled: true, header_name: 'X-MW-Token', token: '' },
  })

  const tokenValue = watch('token')

  const { mutate, isPending } = useMutation({
    mutationFn: (d: AuthFormFields) =>
      authService.set(sourceId, {
        enabled: d.enabled,
        mode: 'static_token',
        header_name: d.header_name,
        token: d.token,
      } satisfies IngressAuth),
    onSuccess: () => addToast('success', 'Ingress auth saved'),
    onError: (e: Error) => addToast('error', e.message),
  })

  return (
    <Card
      title="Ingress Authentication"
      description="Only requests with the correct X-MW-Token header will be accepted"
    >
      <form onSubmit={handleSubmit((d) => mutate(d))} className="space-y-4">
        <div className="flex items-center gap-3">
          <input type="checkbox" id="enabled" {...register('enabled')} className="w-4 h-4 rounded" />
          <label htmlFor="enabled" className="text-sm font-medium text-gray-700">Enable authentication</label>
        </div>

        <Input
          label="Header Name"
          error={errors.header_name?.message}
          {...register('header_name', { required: 'Required' })}
        />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Token</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showToken ? 'text' : 'password'}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono pr-10 focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="Set a strong random token"
                {...register('token', { required: 'Required' })}
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setValue('token', generateToken())}
              title="Generate random token"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => { navigator.clipboard.writeText(tokenValue); addToast('info', 'Copied!') }}
              title="Copy token"
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          {errors.token && <p className="text-xs text-red-600">{errors.token.message}</p>}
          <p className="text-xs text-gray-400">Token is write-only — backend returns masked value on read</p>
        </div>

        <div className="p-3 bg-gray-50 rounded-lg font-mono text-xs text-gray-500 border border-gray-200">
          curl -X POST /webhook \<br />
          &nbsp;&nbsp;-H &quot;X-MW-Token: {tokenValue || '<token>'}&quot; \<br />
          &nbsp;&nbsp;-d &apos;{`{"source":"${sourceId}","webhook_event":{...}}`}&apos;
        </div>

        <Button type="submit" loading={isPending}>Save Auth Config</Button>
      </form>
    </Card>
  )
}

// ─── Source Selector (shared) ──────────────────────────────────────────────────
export function SourceSelector() {
  const { sources, selected, setSelected } = useSourceStore()

  if (!sources.length) return (
    <p className="text-sm text-gray-400">No sources yet. Create one first.</p>
  )

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {sources.map((s) => (
        <button
          key={s}
          onClick={() => setSelected(s)}
          className={`px-3 py-1 rounded-full text-sm font-mono border transition-colors ${
            selected === s
              ? 'bg-brand-600 text-white border-brand-600'
              : 'bg-white text-gray-600 border-gray-300 hover:border-brand-400'
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  )
}

// ─── Webhook URL display ──────────────────────────────────────────────────────
export function WebhookURL({ sourceId }: { sourceId: string }) {
  const { addToast } = useUIStore()
  const url = `${window.location.origin}/webhook`

  return (
    <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
      <span className="text-xs text-gray-500 font-medium">Webhook URL</span>
      <code className="flex-1 text-xs font-mono text-gray-700 truncate">{url}</code>
      <span className="text-xs bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded font-mono">source={sourceId}</span>
      <button
        onClick={() => { navigator.clipboard.writeText(url); addToast('info', 'Copied!') }}
        className="text-gray-400 hover:text-gray-600"
      >
        <Copy className="w-4 h-4" />
      </button>
    </div>
  )
}
