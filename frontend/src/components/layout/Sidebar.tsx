import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Layers, ArrowRightLeft, Settings, Zap } from 'lucide-react'
import { clsx } from 'clsx'

const NAV = [
  { to: '/',         label: 'Dashboard',   icon: LayoutDashboard },
  { to: '/sources',  label: 'Sources',     icon: Layers },
  { to: '/mapping',  label: 'Mapping',     icon: ArrowRightLeft },
  { to: '/egress',   label: 'Egress',      icon: Settings },
  { to: '/wizard',   label: 'New Integration', icon: Zap },
]

export function Sidebar() {
  return (
    <aside className="w-56 shrink-0 h-screen sticky top-0 bg-gray-950 text-gray-300 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white text-sm leading-tight">
            FlightHub<br />
            <span className="text-gray-400 font-normal">Webhook Transformer</span>
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                isActive
                  ? 'bg-brand-600 text-white'
                  : 'hover:bg-gray-800 hover:text-white',
              )
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-500">
        POC v0.2 · DJI FlightHub2
        <div className="mt-1 font-mono break-all text-gray-600 text-[10px]">POST /webhook</div>
      </div>
    </aside>
  )
}
