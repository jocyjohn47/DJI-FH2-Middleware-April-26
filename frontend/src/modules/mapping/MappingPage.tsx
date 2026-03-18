import { useSourceStore } from '@/store'
import { Card } from '@/components/ui/Card'
import { SourceSelector } from '@/modules/source/SourceForm'
import { MappingEditor } from '@/modules/mapping/MappingEditor'

export default function MappingPage() {
  const { selected } = useSourceStore()
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Field Mapping</h1>
      <Card title="Select Source"><SourceSelector /></Card>
      {selected
        ? <MappingEditor sourceId={selected} />
        : <p className="text-sm text-gray-400">Select a source above to edit its mapping.</p>}
    </div>
  )
}
