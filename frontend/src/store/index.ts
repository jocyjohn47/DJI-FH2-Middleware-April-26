import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { WizardStep, VisualMapping, FH2Body } from '@/types'

// ─── Auth / session store ─────────────────────────────────────────────────────
interface AuthStore {
  adminToken: string
  setAdminToken: (t: string) => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  adminToken: localStorage.getItem('admin_token') ?? '',
  setAdminToken: (t) => {
    localStorage.setItem('admin_token', t)
    set({ adminToken: t })
  },
}))

// ─── Source list store ────────────────────────────────────────────────────────
interface SourceStore {
  sources: string[]
  selected: string
  setSources: (s: string[]) => void
  setSelected: (s: string) => void
}

export const useSourceStore = create<SourceStore>((set) => ({
  sources: [],
  selected: '',
  setSources: (sources) => set({ sources }),
  setSelected: (selected) => set({ selected }),
}))

// ─── Wizard store ─────────────────────────────────────────────────────────────
const WIZARD_ORDER: WizardStep[] = [
  'create_source',
  'configure_auth',
  'configure_mapping',
  'configure_egress',
  'test',
]

interface WizardStore {
  active: boolean
  sourceId: string
  currentStep: WizardStep
  completedSteps: Set<WizardStep>
  startWizard: (sourceId?: string) => void
  completeStep: (step: WizardStep) => void
  goToStep: (step: WizardStep) => void
  closeWizard: () => void
  canProceed: () => boolean
}

export const useWizardStore = create<WizardStore>((set, get) => ({
  active: false,
  sourceId: '',
  currentStep: 'create_source',
  completedSteps: new Set(),

  startWizard: (sourceId = '') =>
    set({
      active: true,
      sourceId,
      currentStep: sourceId ? 'configure_auth' : 'create_source',
      completedSteps: sourceId ? new Set<WizardStep>(['create_source']) : new Set(),
    }),

  completeStep: (step) => {
    const { completedSteps } = get()
    const next = WIZARD_ORDER[WIZARD_ORDER.indexOf(step) + 1]
    set({
      completedSteps: new Set([...completedSteps, step]),
      currentStep: next ?? step,
    })
  },

  goToStep: (step) => set({ currentStep: step }),

  closeWizard: () =>
    set({ active: false, sourceId: '', currentStep: 'create_source', completedSteps: new Set() }),

  canProceed: () => {
    const { currentStep, completedSteps } = get()
    return completedSteps.has(currentStep)
  },
}))

// ─── UI / notification store ──────────────────────────────────────────────────
export type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: string
  type: ToastType
  message: string
}

interface UIStore {
  toasts: Toast[]
  addToast: (type: ToastType, message: string) => void
  removeToast: (id: string) => void
}

export const useUIStore = create<UIStore>((set, get) => ({
  toasts: [],
  addToast: (type, message) => {
    const id = `${Date.now()}-${Math.random()}`
    set({ toasts: [...get().toasts, { id, type, message }] })
    setTimeout(() => get().removeToast(id), 4000)
  },
  removeToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

// ─── Visual Mapping store ─────────────────────────────────────────────────────
// Persisted per-source mapping in localStorage so refreshing doesn't lose work.

interface MappingStore {
  /** normalized_field → fh2_body_path  e.g. { "event.name": "name", "device.id": "params.device_id" } */
  mapping: VisualMapping
  /** Available normalized field keys from last debug run */
  normalizedFields: string[]
  /** Live-computed FH2 preview body */
  preview: FH2Body | null
  /** Body paths that are required but unmapped/unfilled */
  missing: string[]
  /** Last sample payload JSON string used for debug run */
  samplePayload: string

  setMapping: (m: VisualMapping) => void
  setMappingField: (src: string, dst: string) => void
  clearMappingField: (src: string) => void
  setNormalizedFields: (fields: string[]) => void
  setPreview: (body: FH2Body | null) => void
  setMissing: (m: string[]) => void
  setSamplePayload: (s: string) => void
  resetMapping: () => void
}

const DEFAULT_SAMPLE = JSON.stringify({
  timestamp: '2026-03-19T10:00:00Z',
  creator_id: 'pilot01',
  latitude: 22.543096,
  longitude: 114.057865,
  level: 'warning',
  description: 'obstacle detected',
  Event: { Name: 'VMD', Source: { Id: 'DJI-001' }, Level: 'warning' },
}, null, 2)

export const useMappingStore = create<MappingStore>()(
  persist(
    (set) => ({
      mapping: {},
      normalizedFields: [],
      preview: null,
      missing: [],
      samplePayload: DEFAULT_SAMPLE,

      setMapping: (mapping) => set({ mapping }),
      setMappingField: (src, dst) =>
        set((s) => ({ mapping: { ...s.mapping, [src]: dst } })),
      clearMappingField: (src) =>
        set((s) => {
          const next = { ...s.mapping }
          delete next[src]
          return { mapping: next }
        }),
      setNormalizedFields: (normalizedFields) => set({ normalizedFields }),
      setPreview: (preview) => set({ preview }),
      setMissing: (missing) => set({ missing }),
      setSamplePayload: (samplePayload) => set({ samplePayload }),
      resetMapping: () => set({ mapping: {}, preview: null, missing: [] }),
    }),
    {
      name: 'fh2-visual-mapping',
      // Only persist mapping + samplePayload (not derived state)
      partialize: (s) => ({ mapping: s.mapping, samplePayload: s.samplePayload }),
    }
  )
)
