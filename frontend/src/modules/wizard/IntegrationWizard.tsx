import { useWizardStore, useUIStore, useSourceStore } from '@/store'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SourceCreateForm, SourceAuthForm } from '@/modules/source/SourceForm'
import { MappingBoard } from '@/modules/mapping/MappingBoard'
import { EgressConfigPanel } from '@/modules/egress/EgressConfigPanel'
import { IntegrationTest } from './IntegrationTest'
import { CheckCircle, Circle, ArrowRight, Info } from 'lucide-react'
import type { WizardStep } from '@/types'

const STEPS: { key: WizardStep; label: string; description: string }[] = [
  { key: 'create_source',    label: '1. Create Source',       description: 'Name your webhook entry point' },
  { key: 'configure_auth',   label: '2. Ingress Auth',        description: 'Set inbound token' },
  { key: 'configure_mapping',label: '3. Visual Mapping',      description: 'Map fields to FlightHub2' },
  { key: 'configure_egress', label: '4. Egress Config',       description: 'FlightHub2 endpoint & tokens' },
  { key: 'test',             label: '5. Test',                description: 'Run end-to-end test' },
]

export function IntegrationWizard() {
  const { currentStep, completedSteps, sourceId, goToStep, completeStep, closeWizard } = useWizardStore()
  const { addToast } = useUIStore()
  const { setSources, sources } = useSourceStore()

  const handleSourceCreated = (id: string) => {
    setSources([...new Set([...sources, id])])
    useWizardStore.getState().startWizard(id)
    completeStep('create_source')
    addToast('success', `Source "${id}" created — continue setup`)
  }

  // Shared "config already saved" hint for wizard steps
  const SavedHint = ({ text }: { text: string }) => (
    <div className="flex items-start gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 mb-3">
      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>{text}</span>
    </div>
  )

  return (
    <div className="flex gap-6">
      {/* Step indicator */}
      <div className="w-52 shrink-0">
        <div className="space-y-1">
          {STEPS.map((s) => {
            const done = completedSteps.has(s.key)
            const active = currentStep === s.key
            return (
              <button
                key={s.key}
                onClick={() => goToStep(s.key)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
                  active   ? 'bg-brand-600 text-white' :
                  done     ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' :
                             'text-gray-500 hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center gap-2">
                  {done
                    ? <CheckCircle className="w-4 h-4 shrink-0" />
                    : <Circle className="w-4 h-4 shrink-0 opacity-50" />}
                  <div>
                    <div className="text-xs font-semibold">{s.label}</div>
                    <div className={`text-xs mt-0.5 ${active ? 'text-brand-200' : 'opacity-60'}`}>{s.description}</div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-200">
          <Button variant="ghost" size="sm" onClick={closeWizard} className="w-full">
            Exit Wizard
          </Button>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 min-w-0">
        {currentStep === 'create_source' && (
          <SourceCreateForm onCreated={handleSourceCreated} />
        )}

        {currentStep === 'configure_auth' && sourceId && (
          <div className="space-y-4">
            {completedSteps.has('configure_auth') && (
              <SavedHint text="Auth config was already saved. You can update it below or click Next to proceed." />
            )}
            <SourceAuthForm sourceId={sourceId} />
            <div className="flex justify-end">
              <Button onClick={() => completeStep('configure_auth')}>
                Next <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {currentStep === 'configure_mapping' && sourceId && (
          <div className="space-y-4">
            {completedSteps.has('configure_mapping') && (
              <SavedHint text="Field mapping was already saved. Load fields and adjust as needed, or click Next to continue." />
            )}
            <p className="text-sm text-gray-500">
              Use the visual mapper to load normalized fields, map them to FlightHub2 body fields, and save.
            </p>
            <MappingBoard wizardSourceId={sourceId} />
            <div className="flex justify-end">
              <Button onClick={() => completeStep('configure_mapping')}>
                Next <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {currentStep === 'configure_egress' && sourceId && (
          <div className="space-y-4">
            {completedSteps.has('configure_egress') && (
              <SavedHint text="Egress config was already saved. Sensitive tokens are masked for security — enter new values only if you need to update them." />
            )}
            <EgressConfigPanel sourceId={sourceId} />
            <div className="flex justify-end">
              <Button onClick={() => completeStep('configure_egress')}>
                Next <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {currentStep === 'test' && sourceId && (
          <IntegrationTest sourceId={sourceId} />
        )}

        {!sourceId && currentStep !== 'create_source' && (
          <Card>
            <p className="text-sm text-gray-500 text-center py-8">No source selected. Go back to Step 1.</p>
          </Card>
        )}
      </div>
    </div>
  )
}
