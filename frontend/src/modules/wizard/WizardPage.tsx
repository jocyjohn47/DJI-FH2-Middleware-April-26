import { useWizardStore } from '@/store'
import { IntegrationWizard } from '@/modules/wizard/IntegrationWizard'
import { Button } from '@/components/ui/Button'
import { Zap } from 'lucide-react'

export default function WizardPage() {
  const { active, startWizard } = useWizardStore()

  if (!active) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-16 h-16 bg-brand-100 rounded-2xl flex items-center justify-center">
          <Zap className="w-8 h-8 text-brand-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">New Integration</h1>
        <p className="text-sm text-gray-500 max-w-sm text-center">
          The guided wizard walks you through all 5 steps: Source → Auth → Mapping → Egress → Test
        </p>
        <Button onClick={() => startWizard()}>Start Setup Wizard</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Integration Setup Wizard</h1>
      <IntegrationWizard />
    </div>
  )
}
