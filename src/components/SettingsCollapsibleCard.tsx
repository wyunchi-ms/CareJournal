import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

interface SettingsCollapsibleCardProps {
  id?: string
  className?: string
  icon: ReactNode
  title: string
  summary: ReactNode
  expanded: boolean
  onToggle: () => void
  children: ReactNode
}

export function SettingsCollapsibleCard({
  id,
  className = '',
  icon,
  title,
  summary,
  expanded,
  onToggle,
  children,
}: SettingsCollapsibleCardProps) {
  const contentId = `${id ?? title.replace(/\s+/g, '-').toLowerCase()}-content`
  return <section id={id} className={`settings-section card settings-collapsible-card${expanded ? ' expanded' : ''}${className ? ` ${className}` : ''}`}>
    <button
      type="button"
      className="settings-collapse-trigger"
      aria-expanded={expanded}
      aria-controls={contentId}
      onClick={onToggle}
    >
      <span className="settings-icon">{icon}</span>
      <span className="settings-collapse-copy"><strong>{title}</strong><small>{summary}</small></span>
      <ChevronDown className="settings-collapse-chevron" aria-hidden="true" />
    </button>
    {expanded && <div id={contentId} className="settings-collapsible-content">{children}</div>}
  </section>
}
