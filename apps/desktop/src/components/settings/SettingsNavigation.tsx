import {
  IconChevronLeft,
  IconCpu,
  IconFileEdit,
  IconInfo,
  IconSettings,
  IconWorkers,
} from '../Icons'

export type SettingsTabId = 'general' | 'model' | 'prompts' | 'workers' | 'about'

interface SettingsNavigationProps {
  ariaLabel: string
  backLabel: string
  items: ReadonlyArray<{ id: SettingsTabId; label: string }>
  onClose: () => void
  onTabChange: (tab: SettingsTabId) => void
  tab: SettingsTabId
}

function navIcon(id: SettingsTabId) {
  if (id === 'general') return <IconSettings size={16} />
  if (id === 'model') return <IconCpu size={16} />
  if (id === 'prompts') return <IconFileEdit size={16} />
  if (id === 'workers') return <IconWorkers size={16} />
  return <IconInfo size={16} />
}

/** Stable Settings shell navigation; tab content remains owned by SettingsPanel. */
export function SettingsNavigation({
  ariaLabel,
  backLabel,
  items,
  onClose,
  onTabChange,
  tab,
}: SettingsNavigationProps) {
  return (
    <aside className="settings-nav" aria-label={ariaLabel}>
      {/* System traffic-light and drag-region reservation. */}
      <div className="sidebar-top" aria-hidden />
      <button type="button" className="settings-back" onClick={onClose}>
        <IconChevronLeft size={14} />
        {backLabel}
      </button>
      <nav className="settings-nav-list">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-nav-item${tab === item.id ? ' on' : ''}`}
            onClick={() => onTabChange(item.id)}
          >
            <span className="glyph" aria-hidden>
              {navIcon(item.id)}
            </span>
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  )
}
