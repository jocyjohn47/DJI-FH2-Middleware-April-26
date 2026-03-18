import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery } from '@tanstack/react-query'
import { egressService, tokenService } from '@/services'
import { useUIStore } from '@/store'
import { Card } from '@/components/ui/Card'
import { Input, Textarea } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Eye, EyeOff, Wand2, CheckCircle, AlertCircle } from 'lucide-react'
import type { EgressConfig } from '@/types'

const DEFAULT_EGRESS: EgressConfig = {
  endpoint: 'https://es-flight-api-us.djigate.com/openapi/v0.1/workflow',
  headers: {
    'Content-Type': 'application/json',
    'X-User-Token': '',
    'x-project-uuid': '',
  },
  template_body: {
    workflow_uuid: '',
    trigger_type: 0,
    name: 'Alert-{{timestamp}}',
    params: {
      creator: '{{creator_id}}',
      latitude: '{{latitude}}',
      longitude: '{{longitude}}',
      level: '{{level}}',
      desc: '{{description}}',
    },
  },
  retry_policy: { max_retries: 3, backoff: 'exponential' },
}

// ─── Sensitive field masking ──────────────────────────────────────────────────
function SensitiveInput({
  label, value, onChange, placeholder, hint,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  const [show, setShow] = useState(false)
  const isMasked = value.includes('****')

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono pr-10 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {isMasked && <p className="text-xs text-amber-600">⚠ Backend returned masked value — enter new token to update</p>}
      {hint && !isMasked && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface FormValues {
  endpoint: string
  userToken: string
  projectUuid: string
  workflowUuid: string
  templateBodyJson: string
  maxRetries: number
  backoff: 'exponential' | 'linear'
  // Token extractor paste field
  rawPaste: string
}

export function EgressConfigPanel({ sourceId }: { sourceId: string }) {
  const { addToast } = useUIStore()
  const [extractResult, setExtractResult] = useState<Record<string, string>>({})
  const [extractStatus, setExtractStatus] = useState<'idle'|'ok'|'err'>('idle')

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } =
    useForm<FormValues>({
      defaultValues: {
        endpoint: DEFAULT_EGRESS.endpoint,
        userToken: '',
        projectUuid: '',
        workflowUuid: '',
        templateBodyJson: JSON.stringify(DEFAULT_EGRESS.template_body, null, 2),
        maxRetries: 3,
        backoff: 'exponential',
        rawPaste: '',
      },
    })

  // Load existing config
  useQuery({
    queryKey: ['egress', sourceId],
    queryFn: () => egressService.get(sourceId),
    enabled: !!sourceId,
    onSuccess: (cfg: EgressConfig) => {
      reset({
        endpoint: cfg.endpoint,
        userToken:    (cfg.headers['X-User-Token']  ?? ''),
        projectUuid:  (cfg.headers['x-project-uuid'] ?? ''),
        workflowUuid: (cfg.template_body['workflow_uuid'] as string) ?? '',
        templateBodyJson: JSON.stringify(cfg.template_body, null, 2),
        maxRetries: cfg.retry_policy.max_retries,
        backoff: cfg.retry_policy.backoff,
        rawPaste: '',
      })
    },
  } as Parameters<typeof useQuery>[0])

  // Save
  const { mutate: save, isPending } = useMutation({
    mutationFn: (d: FormValues) => {
      let template_body = DEFAULT_EGRESS.template_body
      try { template_body = JSON.parse(d.templateBodyJson) as typeof template_body } catch { /**/ }
      const cfg: EgressConfig = {
        endpoint: d.endpoint,
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token':  d.userToken,
          'x-project-uuid': d.projectUuid,
        },
        template_body: { ...template_body, workflow_uuid: d.workflowUuid },
        retry_policy: { max_retries: Number(d.maxRetries), backoff: d.backoff },
      }
      return egressService.set(sourceId, cfg)
    },
    onSuccess: () => addToast('success', 'Egress config saved'),
    onError: (e: Error) => addToast('error', e.message),
  })

  // Token extractor
  const { mutate: extract, isPending: extracting } = useMutation({
    mutationFn: () => tokenService.extract(watch('rawPaste')),
    onSuccess: (extracted) => {
      setExtractResult(extracted)
      setExtractStatus('ok')
      if (extracted['X-User-Token'])  setValue('userToken',    extracted['X-User-Token'])
      if (extracted['x-project-uuid']) setValue('projectUuid', extracted['x-project-uuid'])
      if (extracted['workflow_uuid'])  setValue('workflowUuid', extracted['workflow_uuid'])
      addToast('success', `Extracted ${Object.keys(extracted).length} field(s) and applied`)
    },
    onError: (e: Error) => { setExtractStatus('err'); addToast('error', e.message) },
  })

  const userToken   = watch('userToken')
  const projectUuid = watch('projectUuid')

  return (
    <div className="space-y-4">
      {/* ── Main config ─────────────────────────────────────────────────── */}
      <Card title="FlightHub2 Egress Configuration" description="Downstream API endpoint and authentication">
        <form onSubmit={handleSubmit((d) => save(d))} className="space-y-5">

          {/* Endpoint */}
          <Input
            label="API Endpoint"
            placeholder="https://..."
            error={errors.endpoint?.message}
            {...register('endpoint', { required: 'Required', pattern: { value: /^https?:\/\//, message: 'Must be a URL' } })}
          />

          {/* Sensitive headers */}
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">🔐 Sensitive Credentials</p>
            <SensitiveInput
              label="X-User-Token"
              value={userToken}
              onChange={(v) => setValue('userToken', v)}
              placeholder="FlightHub2 user token"
              hint="Stored encrypted, masked on read"
            />
            <SensitiveInput
              label="x-project-uuid"
              value={projectUuid}
              onChange={(v) => setValue('projectUuid', v)}
              placeholder="FlightHub2 project UUID"
            />
            <Input
              label="workflow_uuid"
              placeholder="FlightHub2 workflow UUID"
              {...register('workflowUuid')}
            />
          </div>

          {/* Template body */}
          <Textarea
            label="Template Body (JSON with {{variable}} placeholders)"
            rows={10}
            mono
            error={errors.templateBodyJson?.message}
            {...register('templateBodyJson', {
              validate: (v) => { try { JSON.parse(v); return true } catch { return 'Invalid JSON' } },
            })}
          />

          {/* Retry policy */}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Max Retries"
              type="number"
              min={0} max={10}
              {...register('maxRetries')}
            />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Backoff Strategy</label>
              <select
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                {...register('backoff')}
              >
                <option value="exponential">Exponential</option>
                <option value="linear">Linear</option>
              </select>
            </div>
          </div>

          <Button type="submit" loading={isPending}>Save Egress Config</Button>
        </form>
      </Card>

      {/* ── Token extractor ──────────────────────────────────────────────── */}
      <Card
        title="Token Extractor"
        description="Paste raw HTTP headers / curl commands / JSON — auto-extract FlightHub2 tokens"
      >
        <div className="space-y-3">
          <Textarea
            placeholder={'X-User-Token: xxx\nx-project-uuid: yyy\nworkflow_uuid=zzz\n\nor paste a full curl command'}
            rows={6}
            mono
            {...register('rawPaste')}
          />
          <Button
            type="button"
            variant="secondary"
            loading={extracting}
            onClick={() => extract()}
          >
            <Wand2 className="w-4 h-4" /> Extract & Apply
          </Button>

          {extractStatus !== 'idle' && (
            <div className={`flex items-center gap-2 text-sm ${extractStatus === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
              {extractStatus === 'ok'
                ? <><CheckCircle className="w-4 h-4" /> Applied: {Object.keys(extractResult).join(', ')}</>
                : <><AlertCircle className="w-4 h-4" /> Extraction failed</>}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
