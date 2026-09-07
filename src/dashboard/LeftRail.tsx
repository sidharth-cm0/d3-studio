import React from 'react'

export type LeftRailSection = 'story' | 'script' | 'scenes' | 'characters' | 'environment' | 'mocap'

export interface LeftRailProps {
  activeSection: LeftRailSection
  setActiveSection: (sec: LeftRailSection) => void
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
}

export function LeftRail({
  activeSection,
  setActiveSection,
  sidebarCollapsed,
  setSidebarCollapsed,
}: LeftRailProps) {
  const sections: { id: LeftRailSection; label: string; icon: string }[] = [
    { id: 'story', label: 'Story', icon: '✍️' },
    { id: 'script', label: 'Script', icon: '📄' },
    { id: 'scenes', label: 'Scenes', icon: '🎬' },
    { id: 'characters', label: 'Actors', icon: '🎭' },
    { id: 'environment', label: 'Stage', icon: '🌍' },
    { id: 'mocap', label: 'MoCap', icon: '🎥' },
  ]

  const handleItemClick = (id: LeftRailSection) => {
    if (activeSection === id && !sidebarCollapsed) {
      setSidebarCollapsed(true)
    } else {
      setActiveSection(id)
      setSidebarCollapsed(false)
    }
  }

  return (
    <div className="d3-left-rail">
      <div className="d3-left-rail__list">
        {sections.map((sec) => {
          const isActive = activeSection === sec.id && !sidebarCollapsed
          return (
            <button
              key={sec.id}
              type="button"
              className={`d3-left-rail__item ${isActive ? 'd3-left-rail__item--active' : ''}`}
              onClick={() => handleItemClick(sec.id)}
              title={`${sec.label} Panel`}
            >
              <span className="d3-left-rail__icon">{sec.icon}</span>
              <span className="d3-left-rail__label">{sec.label}</span>
            </button>
          )
        })}
      </div>

      <button
        type="button"
        className="d3-left-rail__collapse"
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        title={sidebarCollapsed ? 'Expand Panel' : 'Collapse Panel'}
      >
        <span style={{ fontSize: '14px' }}>{sidebarCollapsed ? '→' : '←'}</span>
      </button>
    </div>
  )
}
