/**
 * DevicePicker.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Compact panel embedded in MappingBoard.
 * Provides two things:
 *
 *  A. Device ID Field Config
 *     Some vendors don't have a `device_id` field; they might use `deviceSN`,
 *     `camera.id`, or any other field.  This lets you configure which payload
 *     field (after flattening) should be used as the device lookup key.
 *     Stored in uw:deviceidfield:{source}
 *
 *  B. Device GPS Fallback Registry
 *     Registered devices with fixed GPS coordinates.  Stored in
 *     uw:device:{device_id}  — when the worker resolves a device_id (via the
 *     field above or the default `device_id` key), it injects lat/lng from here.
 */
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapPin, Plus, Check, X, Edit2, ChevronDown, ChevronRight, Save, Fingerprint } from 'lucide-react'
import { deviceService, deviceIdFieldService } from '@/services'
import { useUIStore } from '@/store'
import type { DeviceInfo } from '@/types'

interface DevicePickerProps {
  sourceId: string
  /** Notify parent when device_id_field changes so MissingPanel can update */
  onDeviceIdFieldChange?: (field: string) => void
}

const EMPTY_DEVICE: DeviceInfo = {
  device_id: '',
  model: '',
  site: '',
  location: { lat: null, lng: null, alt: null },
}

export function DevicePicker({ sourceId, onDeviceIdFieldChange }: DevicePickerProps) {
  const { addToast } = useUIStore()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  // ── Section A: Device ID Field ────────────────────────────────────────────
  const [deviceIdField, setDeviceIdField] = useState('')
  const [fieldDirty, setFieldDirty] = useState(false)

  const { data: deviceIdFieldData } = useQuery({
    queryKey: ['device-id-field', sourceId],
    queryFn: () => deviceIdFieldService.get(sourceId),
    enabled: !!sourceId,
    staleTime: 0,
  })

  useEffect(() => {
    if (deviceIdFieldData !== undefined) {
      setDeviceIdField(deviceIdFieldData)
      onDeviceIdFieldChange?.(deviceIdFieldData)
      setFieldDirty(false)
    }
  }, [deviceIdFieldData]) // eslint-disable-line react-hooks/exhaustive-deps

  const { mutate: saveField, isPending: savingField } = useMutation({
    mutationFn: () => deviceIdFieldService.set(sourceId, deviceIdField),
    onSuccess: () => {
      addToast('success', 'Device ID field saved')
      setFieldDirty(false)
      onDeviceIdFieldChange?.(deviceIdField)
      qc.invalidateQueries({ queryKey: ['device-id-field', sourceId] })
    },
    onError: (e: Error) => addToast('error', e.message),
  })

  // ── Section B: Device list ────────────────────────────────────────────────
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
    (d) => d.location?.lat != null && d.location?.lng != null,
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
          <span className="text-sm font-semibold text-gray-700">Device GPS Fallback</span>
          {/* Badges */}
          {deviceIdField && (
            <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5 font-mono">
              id: {deviceIdField}
            </span>
          )}
          {hasDeviceGps && (
            <span className="text-xs bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5">
              {devices.filter(d => d.location?.lat != null).length} GPS
            </span>
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

          {/* ── How it works ─────────────────────────────────────────────── */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 text-xs text-blue-800">
            <p className="font-semibold mb-1.5">工作原理：三步注入 GPS</p>
            <ol className="space-y-1.5 list-none">
              <li className="flex items-start gap-2">
                <span className="shrink-0 w-4 h-4 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-[10px]">1</span>
                <span>
                  <strong>Device ID Field</strong>（下方配置）确定 payload 中哪个字段是设备标识符。
                  例如配置为 <code className="bg-blue-100 px-1 rounded font-mono">deviceSN</code>，
                  则从 payload 读取 <code className="bg-blue-100 px-1 rounded font-mono">payload.deviceSN</code> 的实际值（如 <code className="bg-blue-100 px-1 rounded font-mono">DJI-001</code>）。
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="shrink-0 w-4 h-4 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-[10px]">2</span>
                <span>
                  <strong>Device Registry</strong>（下方表格）将设备 ID 值与固定 GPS 坐标对应。
                  例如 ID = <code className="bg-blue-100 px-1 rounded font-mono">DJI-001</code> →
                  lat = <code className="bg-blue-100 px-1 rounded font-mono">22.5431</code>，lng = <code className="bg-blue-100 px-1 rounded font-mono">114.0579</code>。
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="shrink-0 w-4 h-4 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-[10px]">3</span>
                <span>
                  <strong>自动注入</strong>：Worker 处理消息时，若 <code className="bg-blue-100 px-1 rounded font-mono">params.latitude</code> /
                  <code className="bg-blue-100 px-1 rounded font-mono ml-1">params.longitude</code> 尚未映射，
                  则用查找结果自动填充，无需在 payload 中包含 GPS 字段。
                </span>
              </li>
            </ol>
          </div>

          {/* ── A. Device ID Field Config ─────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Fingerprint className="w-3.5 h-3.5 text-indigo-500" />
              <span className="text-xs font-semibold text-gray-700">步骤 1：Device ID Field</span>
              <span className="text-xs text-gray-400">— payload 中哪个字段是设备标识符</span>
            </div>
            <p className="text-xs text-gray-400 mb-2">
              填写 payload 展开后（flattened）的字段路径。空白则默认使用
              <code className="font-mono bg-gray-100 px-1 mx-0.5 rounded">device_id</code> 字段。
            </p>

            <div className="flex items-center gap-2">
              <input
                className={[
                  'flex-1 text-xs font-mono border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors',
                  deviceIdField ? 'border-indigo-300 bg-indigo-50' : 'border-gray-300',
                ].join(' ')}
                placeholder="e.g. deviceSN  /  camera.sn  /  Event.DeviceId  （空白 = device_id）"
                value={deviceIdField}
                onChange={(e) => {
                  setDeviceIdField(e.target.value)
                  setFieldDirty(true)
                  onDeviceIdFieldChange?.(e.target.value)
                }}
              />
              {fieldDirty && (
                <button
                  type="button"
                  onClick={() => saveField()}
                  disabled={savingField}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingField ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>

            {deviceIdField && (
              <p className="text-xs text-indigo-600 mt-1.5">
                ✓ Worker 将读取 payload 中 <code className="font-mono bg-indigo-50 px-1 rounded">{deviceIdField}</code> 字段的值作为设备 ID
              </p>
            )}
          </div>

          {/* divider */}
          <div className="border-t border-gray-100" />

          {/* ── B. Device GPS Registry ───────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <MapPin className="w-3.5 h-3.5 text-teal-500" />
              <span className="text-xs font-semibold text-gray-700">步骤 2：Device Registry</span>
              <span className="text-xs text-gray-400">— 设备 ID 值 → 固定 GPS 坐标</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              注册设备 ID 值（即 payload 中该字段的实际内容）与固定经纬度的对应关系。
              Device ID 列应与 payload 中的实际值完全匹配。
            </p>

            {devices.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {/* Header row */}
                <div className="grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr_0.8fr_0.7fr_auto] gap-2 px-2 text-xs font-medium text-gray-400">
                  {['Device ID', 'Model', 'Site', 'Lat', 'Lng', 'Alt', ''].map((h) => (
                    <span key={h}>{h}</span>
                  ))}
                </div>

                {devices.map((d) =>
                  editingId === d.device_id ? (
                    <div
                      key={d.device_id}
                      className="grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr_0.8fr_0.7fr_auto] gap-2 items-center bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5"
                    >
                      <span className="text-xs font-mono text-gray-600 truncate">{d.device_id}</span>
                      {(['model', 'site'] as const).map((f) => (
                        <input
                          key={f}
                          className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-400"
                          value={(editDraft[f] as string) ?? ''}
                          onChange={(e) => patchDevice(editDraft, setEditDraft, f, e.target.value)}
                          placeholder={f}
                        />
                      ))}
                      {(['lat', 'lng', 'alt'] as const).map((f) => (
                        <input
                          key={f}
                          type="number"
                          step="any"
                          className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-400"
                          value={editDraft.location?.[f] ?? ''}
                          onChange={(e) => patchDevice(editDraft, setEditDraft, f, e.target.value)}
                          placeholder={f}
                        />
                      ))}
                      <div className="flex gap-1">
                        <button
                          onClick={() => saveDevice(editDraft)}
                          className="w-6 h-6 flex items-center justify-center rounded text-emerald-600 hover:bg-emerald-100"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={d.device_id}
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
                        <button
                          onClick={() => { setEditingId(d.device_id); setEditDraft({ ...d, location: { ...d.location } }) }}
                          className="w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-brand-500 hover:bg-brand-50 transition-colors"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => delDevice(d.device_id)}
                          className="w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ),
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
                  <input
                    key={f}
                    className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-400"
                    value={(newDraft[f] as string) ?? ''}
                    onChange={(e) => patchDevice(newDraft, setNewDraft, f, e.target.value)}
                    placeholder={f}
                  />
                ))}
                {(['lat', 'lng', 'alt'] as const).map((f) => (
                  <input
                    key={f}
                    type="number"
                    step="any"
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
                    className="w-6 h-6 flex items-center justify-center rounded text-emerald-600 hover:bg-emerald-100 disabled:opacity-40"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => { setAddMode(false); setNewDraft({ ...EMPTY_DEVICE }) }}
                    className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100"
                  >
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

          {/* hint when no devices with GPS and no field configured */}
          {!hasDeviceGps && !deviceIdField && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              ⚠ 尚未配置 GPS 注入。请先在步骤 1 填写 Device ID Field，然后在步骤 2 注册设备与对应 GPS 坐标。
            </p>
          )}
          {hasDeviceGps && !deviceIdField && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              ℹ 已注册设备 GPS，但未配置 Device ID Field。请在步骤 1 填写 payload 中的设备标识字段，否则 Worker 无法自动匹配。
            </p>
          )}
        </div>
      )}
    </div>
  )
}
