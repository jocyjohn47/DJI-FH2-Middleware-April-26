import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { runIntegrationTest } from '@/services'
import { Card } from '@/components/ui/Card'
import { Input, Textarea } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { CheckCircle, XCircle, FlaskConical } from 'lucide-react'
import type { TestResult } from '@/services'

interface FormValues {
  ingressToken: string
  webhookEventJson: string
}

const SAMPLE_EVENT = JSON.stringify({
  timestamp: '2026-03-18T10:00:00Z',
  creator_id: 'pilot01',
  latitude: 22.543096,
  longitude: 114.057865,
  level: 'warning',
  description: 'Obstacle detected ahead',
}, null, 2)

export function IntegrationTest({ sourceId }: { sourceId: string }) {
  const [result, setResult] = useState<TestResult | null>(null)

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    defaultValues: { ingressToken: '', webhookEventJson: SAMPLE_EVENT },
  })

  const { mutate, isPending } = useMutation({
    mutationFn: (d: FormValues) => {
      const webhookEvent = JSON.parse(d.webhookEventJson) as Record<string, unknown>
      return runIntegrationTest({ sourceId, ingressToken: d.ingressToken, webhookEvent })
    },
    onSuccess: setResult,
  })

  return (
    <div className="space-y-4">
      <Card
        title="Integration Test"
        description="Send a test webhook event through the full pipeline"
      >
        <form onSubmit={handleSubmit((d) => mutate(d))} className="space-y-4">
          <Input
            label="Ingress Token (X-MW-Token)"
            placeholder="The token you configured in Step 2"
            error={errors.ingressToken?.message}
            {...register('ingressToken', { required: 'Required' })}
          />
          <Textarea
            label="Sample webhook_event (JSON)"
            rows={10}
            mono
            error={errors.webhookEventJson?.message}
            {...register('webhookEventJson', {
              validate: (v) => { try { JSON.parse(v); return true } catch { return 'Invalid JSON' } },
            })}
          />
          <Button type="submit" loading={isPending}>
            <FlaskConical className="w-4 h-4" /> Run Test
          </Button>
        </form>
      </Card>

      {/* Result */}
      {result && (
        <Card title="Test Result">
          <div className="space-y-3">
            {/* Auth gate */}
            <ResultRow
              ok={result.authStatus === 200}
              label="Ingress Auth Gate"
              detail={`HTTP ${result.authStatus}`}
            />
            {/* Queue */}
            <ResultRow
              ok={result.queueAccepted}
              label="Enqueued to Redis Stream"
              detail={result.queueAccepted ? 'accepted' : 'not accepted'}
            />
            {/* Error */}
            {result.error && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <pre className="text-xs text-red-700 font-mono whitespace-pre-wrap">{result.error}</pre>
              </div>
            )}
            {/* Summary */}
            {result.queueAccepted && (
              <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-600" />
                <div>
                  <p className="text-sm font-semibold text-emerald-700">Integration working correctly</p>
                  <p className="text-xs text-emerald-600 mt-0.5">
                    Event accepted → Worker will map & forward to FlightHub2
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

function ResultRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
      {ok
        ? <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
        : <XCircle    className="w-5 h-5 text-red-500 shrink-0" />}
      <span className="flex-1 text-sm text-gray-700">{label}</span>
      <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
        {detail}
      </span>
    </div>
  )
}
