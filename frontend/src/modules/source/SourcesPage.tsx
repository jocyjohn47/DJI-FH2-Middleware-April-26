import { useQuery } from '@tanstack/react-query'
import { sourceService } from '@/services'
import { useSourceStore } from '@/store'
import { Card } from '@/components/ui/Card'
import { SourceCreateForm, SourceAuthForm, WebhookURL, SourceSelector } from '@/modules/source/SourceForm'

export default function SourcesPage() {
  const { setSources, selected } = useSourceStore()

  useQuery({
    queryKey: ['sources'],
    queryFn: sourceService.list,
    onSuccess: setSources,
  } as Parameters<typeof useQuery>[0])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Sources</h1>
      <SourceCreateForm />

      {selected && (
        <>
          <WebhookURL sourceId={selected} />
          <SourceAuthForm sourceId={selected} />
        </>
      )}

      <Card title="Select Source to Configure">
        <SourceSelector />
      </Card>
    </div>
  )
}
