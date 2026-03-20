/**
 * DevicePicker.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Compact panel embedded in MappingBoard.
 * Two sub-sections:
 *
 *  A. GPS Field Mapping  — maps payload field names → lat/lng/alt
 *     Stored in uw:gpsfieldmap:{source}
 *     Used when the vendor payload has GPS but uses non-standard field names,
 *     and there is no device_id concept at all.
 *
 *  B. Device GPS Fallback — registered devices with fixed GPS coords
 *     Stored in uw:device:{device_id}
 *     Used when device_id is in the payload but has no GPS fields.
 *
 * onGpsFieldMapChange: callback so MappingBoard can pass live gpsFieldMap
 * to MissingPanel for real-time coverage display.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapPin, Plus, Check, X, Edit2, ChevronDown, ChevronRight, Save, Route } from 'lucide-react'
import { deviceService, gpsFieldMapService } from '@/services'
import { useUIStore } from '@/store'
import type { DeviceInfo, GpsFieldMap } from '@/types'

interface DevicePickerProps {
  sourceId: string
  onGpsFieldMapChange?: (cfg: GpsFieldMap) => void
}

const EMPTY_DEVICE: DeviceInfo = {
  device_id: '',
  model: '',
  site: '',
  location: { lat: null, lng: null, alt: null },
}

export function DevicePicker({ sourceId, onGpsFieldMapChange }: DevicePickerProps) {
  const { addToast } = useUIStore()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  // ── Section A: GPS Field Map ─────────────────────────────────────────────
  const [gpsMap, setGpsMap] = useState<GpsFieldMap>({})
  const [gpsDirty, setGpsDirty] = useState(false)

  useQuery({
    queryKey: ['gps-field-map', sourceId],
    queryFn: () => gpsFieldMapService.get(sourceId),
    enabled: !!sourceId,
    onSuccess: (cfg: GpsFieldMap) => {
      setGpsMap(cfg)
      onGpsFieldMapChange?.(cfg)
      setGpsDirty(false)
    },
  } as Parameters<typeof useQuery>[0])

  const { mutate: saveGpsMap, isPending: savingGps } = useMutation({
    mutationFn: () => gpsFieldMapService.set(sourceId, gpsMap),
    onSuccess: () => {
      addToast('success', 'GPS field mapping saved')
      setGpsDirty(false)
      onGpsFieldMapChange?.(gpsMap)
      qc.invalidateQueries({ queryKey: ['gps-field-map', sourceId] })
    },
    onError: (e: Error) => addToast('error', e.message),
  })

  const patchGpsMap = (field: keyof GpsFieldMap, val: string) => {
    const next = { ...gpsMap, [field]: val }
    setGpsMap(next)
    setGpsDirty(true)
    onGpsFieldMapChange?.(next)
  }

  // ── Section B: Device list ──────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<DeviceInfo>({ ...EMPTY_DEVICE })
  const [addMode, setAddMode] = useState(false)
  const [newDraft, setNewDraft] = useState<DeviceInfo>({ ...EMPTY_DEVICE })

  const { data: devices = [] } = useQuery({
    queryKey: ['device-list'],
    queryFn: async (): Promise<DeviceInfo[]> => {
      const ids = await deviceService.list()
      if (!ids.length) return []
      return Promise.all(ids.map((id) => deviceService.get(id)))
    },
  })

  const { mutate: saveDevice } = useMutation({
    mutationFn: (d: DeviceInfo) => deviceService.set(d.device_id, d),
    onSuccess: (_data, d) => {
      addToast('success', `Device ${d.device_id} saved`)
      setEditingId(null)
      setAddMode(false)
      setNewDraft({ ...EMPTY_DEVICE })
      qc.invalidateQueries({ queryKey: ['device-list'] })
    },
    onError: (e: Error) => addToast('error', e.message),
  })

  const { mutate: delDevice } = useMutation({
    mutationFn: (id: string) => deviceService.delete(id),
    onSuccess: (_data, id) => {
      addToast('success', `Device ${id} deleted`)
      qc.invalidateQueries({ queryKey: ['device-list'] })
    },
    onError: (e: Error) => addToast('error', e.message),
  })

  const patchDevice = (
    draft: DeviceInfo,
    setDraft: (d: DeviceInfo) => void,
    field: string,
    val: string,
  ) => {
    if (field === 'device_id' || field === 'model' || field === 'site') {
      setDraft({ ...draft, [field]: val })
    } else if (field === 'lat' || field === 'lng' || field === 'alt') {
      setDraft({ ...draft, location: { ...draft.location, [field]: val === '' ? null : parseFloat(val) } })
    }
  }

  const hasDeviceGps = devices.some(
    (d) => d.location?.lat != null && d.location?.lng != null
  )

  return (
    <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
      {/* Header */}
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          <MapPin className="w-4 h-4 text-brand-500" />
          <span className="text-sm font-semibold text-gray-700">GPS Configuration</span>
          {/* badges */}
          {(gpsMap.lat || gpsMap.lng) && (
            <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">field map</span>
          )}
          {devices.length > 0 && (
            <span className="text-xs bg-gray-200 text-gray-600 rounded-full px-2 py-0.5">
              {devices.length} device{devices.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400">{sourceId}</span>
      </button>

      {open && (
        <div className="p-4 space-y-5">

          {/* ── A. GPS Field Mapping ────────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Route className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-xs font-semibold text-gray-700">GPS Field Mapping</span>
              <span className="text-xs text-gray-400">— map payload field paths to GPS coords</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Use when the vendor payload already contains GPS but with non-standard field names.
              Enter the <strong>dot-notation path</strong> as it appears after flattening
              (e.g. <code className="font-mono bg-gray-100 px-1 rounded">Event.Location.Latitude</code>).
              Takes priority over device GPS fallback.
            </p>

            <div className="grid grid-cols-3 gap-3">
              {(['lat', 'lng', 'alt'] as const).map((f) => (
                <div key={f}>
                  <label className="text-xs font-medium text-gray-500 block mb-1">
                    {f === 'lat' ? 'Latitude field' : f === 'lng' ? 'Longitude field' : 'Altitude field (opt)'}
                  </label>
                  <input
                    className={[
                      'w-full text-xs font-mono border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500',
                      gpsMap[f] ? 'border-blue-300 bg-blue-50' : 'border-gray-300',
                    ].join(' ')}
                    placeholder={
                      f === 'lat' ? 'e.g. Event.Lat' :
                      f === 'lng' ? 'e.g. Event.Lng' :
                      'e.g. Event.Alt'
                    }
                    value={gpsMap[f] ?? ''}
                    onChange={(e) => patchGpsMap(f, e.target.value)}
                  />
                </div>
              ))}
            </div>

            {gpsDirty && (
              <button
                type="button"
                onClick={() => saveGpsMap()}
                disabled={savingGps}
                className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                {savingGps ? 'Saving…' : 'Save GPS Field Mapping'}
              </button>
            )}
          </div>

          {/* divider */}
          <div className="border-t border-gray-100" />

          {/* ── B. Device GPS Fallback ──────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-teal-500" />
                <span className="text-xs font-semibold text-gray-700">Device GPS Fallback</span>
                <span className="text-xs text-gray-400">— fixed coords by device_id</span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Use when the payload contains a <code className="font-mono bg-gray-100 px-1 rounded">device_id</code> field
              but no GPS. The autofill step looks up the device record and injects its registered coordinates.
            </p>

            {devices.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {/* Header */}
                <div className="grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr_0.8fr_0.7fr_auto] gap-2 px-2 text-xs font-medium text-gray-400">
                  {['Device ID', 'Model', 'Site', 'Lat', 'Lng', 'Alt', ''].map((h) => (
                    <span key={h}>{h}</span>
                  ))}
                </div>

                {devices.map((d) =>
                  editingId === d.device_id ? (
                    <div key={d.device_id}
                      className="grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr_0.8fr_0.7fr_auto] gap-2 items-center bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5"
                    >
                      <span className="text-xs font-mono text-gray-600 truncate">{d.device_id}</span>
                      {(['model', 'site'] as const).map((f) => (
                        <input key={f}
                          className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-400"
                          value={(editDraft[f] as string) ?? ''}
                          onChange={(e) => patchDevice(editDraft, setEditDraft, f, e.target.value)}
                          placeholder={f}
                        />
                      ))}
                      {(['lat', 'lng', 'alt'] as const).map((f) => (
                        <input key={f} type="number" step="any"
                          className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-400"
                          value={editDraft.location?.[f] ?? ''}
                          onChange={(e) => patchDevice(editDraft, setEditDraft, f, e.target.value)}
                          placeholder={f}
                        />
                      ))}
                      <div className="flex gap-1">
                        <button onClick={() => saveDevice(editDraft)}
                          className="w-6 h-6 flex items-center justify-center rounded text-emerald-600 hover:bg-emerald-100">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditingId(null)}
                          className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={d.device_id}
                      className="grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr_0.8fr_0.7fr_auto] gap-2 items-center px-2 py-1.5 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-100 transition-colors"
                    >
                      <span className="text-xs font-mono text-gray-800 truncate">{d.device_id}</span>
                      <span className="text-xs text-gray-500 truncate">{d.model || '—'}</span>
                      <span className="text-xs text-gray-500">{d.site || '—'}</span>
                      <span className={`text-xs font-mono ${d.location?.lat != null ? 'text-emerald-600' : 'text-gray-300'}`}>
                        {d.location?.lat != null ? d.location.lat.toFixed(4) : '—'}
                      </span>
                      <span className={`text-xs font-mono ${d.location?.lng != null ? 'text-emerald-600' : 'text-gray-300'}`}>
                        {d.location?.lng != null ? d.location.lng.toFixed(4) : '—'}
                      </span>
                      <span className="text-xs font-mono text-gray-500">
                        {d.location?.alt != null ? d.location.alt : '—'}
                      </span>
                      <div className="flex gap-1">
                        <button onClick={() => { setEditingId(d.device_id); setEditDraft({ ...d, location: { ...d.location } }) }}
                          className="w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-brand-500 hover:bg-brand-50 transition-colors">
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button onClick={() => delDevice(d.device_id)}
                          className="w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )
                )}
              </div>
            )}

            {/* Add new device */}
            {addMode ? (
              <div className="grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr_0.8fr_0.7fr_auto] gap-2 items-center bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">
                <input
                  className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-400 font-mono"
                  placeholder="device-id *"
                  value={newDraft.device_id}
                  onChange={(e) => patchDevice(newDraft, setNewDraft, 'device_id', e.target.value)}
                />
                {(['model', 'site'] as const).map((f) => (
                  <input key={f}
                    className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-400"
                    value={(newDraft[f] as string) ?? ''}
                    onChange={(e) => patchDevice(newDraft, setNewDraft, f, e.target.value)}
                    placeholder={f}
                  />
                ))}
                {(['lat', 'lng', 'alt'] as const).map((f) => (
                  <input key={f} type="number" step="any"
                    className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-400"
                    value={newDraft.location?.[f] ?? ''}
                    onChange={(e) => patchDevice(newDraft, setNewDraft, f, e.target.value)}
                    placeholder={f}
                  />
                ))}
                <div className="flex gap-1">
                  <button
                    onClick={() => newDraft.device_id.trim() && saveDevice(newDraft)}
                    disabled={!newDraft.device_id.trim()}
                    className="w-6 h-6 flex items-center justify-center rounded text-emerald-600 hover:bg-emerald-100 disabled:opacity-40">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => { setAddMode(false); setNewDraft({ ...EMPTY_DEVICE }) }}
                    className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setAddMode(true); setEditingId(null) }}
                className="flex items-center gap-1.5 text-xs text-teal-600 hover:text-teal-700 font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Register Device
              </button>
            )}
          </div>

          {/* hint when both empty */}
          {!hasDeviceGps && !gpsMap.lat && !gpsMap.lng && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              ⚠ No GPS source configured. If your payload contains GPS fields, use the field mapping above.
              If your devices have fixed locations, register them below.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
