import { useUIStore } from '@/store'
import { clsx } from 'clsx'
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'

const icons = {
  success: <CheckCircle className="w-5 h-5 text-emerald-500" />,
  error:   <AlertCircle className="w-5 h-5 text-red-500" />,
  info:    <Info className="w-5 h-5 text-brand-500" />,
}

export function ToastContainer() {
  const { toasts, removeToast } = useUIStore()
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 min-w-[280px]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border bg-white',
            'animate-in slide-in-from-right-4 duration-200',
          )}
        >
          {icons[t.type]}
          <p className="flex-1 text-sm text-gray-800">{t.message}</p>
          <button onClick={() => removeToast(t.id)} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
