import { create } from 'zustand'
import type { WizardStep } from '@/types'

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
