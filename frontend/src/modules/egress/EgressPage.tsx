import { useSourceStore } from '@/store'
import { Card } from '@/components/ui/Card'
import { SourceSelector } from '@/modules/source/SourceForm'
import { EgressConfigPanel } from '@/modules/egress/EgressConfigPanel'

export default function EgressPage() {
  const { selected } = useSourceStore()
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Egress Configuration</h1>
      <Card title="Select Source"><SourceSelector /></Card>
      {selected
        ? <EgressConfigPanel sourceId={selected} />
        : <p className="text-sm text-gray-400">Select a source above to edit egress config.</p>}
    </div>
  )
}
