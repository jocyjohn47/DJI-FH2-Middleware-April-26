import { MappingBoard } from '@/modules/mapping/MappingBoard'

export default function MappingPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Visual Field Mapper</h1>
        <p className="text-sm text-gray-500 mt-1">
          Map normalized input fields to FlightHub2 workflow body fields.
          Click <strong>Load Fields &amp; Preview</strong> to see your data flow end-to-end.
        </p>
      </div>
      <MappingBoard />
    </div>
  )
}
