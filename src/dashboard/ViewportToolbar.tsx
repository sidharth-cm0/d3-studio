import React, { useState } from 'react'

export interface ViewportToolbarProps {
  onToolSelected?: (tool: string) => void
}

export function ViewportToolbar({ onToolSelected }: ViewportToolbarProps) {
  const [activeTool, setActiveTool] = useState<string>('select')

  const tools = [
    { id: 'select', label: 'Select Tool (↖️)', icon: '↖️', enabled: true },
    { id: 'move', label: 'Translate Object (✥) [Coming Soon]', icon: '✥', enabled: false },
    { id: 'rotate', label: 'Rotate Object (🔄) [Coming Soon]', icon: '🔄', enabled: false },
    { id: 'scale', label: 'Scale Object (⤢) [Coming Soon]', icon: '⤢', enabled: false },
    { id: 'camera', label: 'Focus Camera (📷)', icon: '📷', enabled: true },
    { id: 'light', label: 'Lighting Rig (💡) [Coming Soon]', icon: '💡', enabled: false },
  ]

  const handleToolClick = (toolId: string, enabled: boolean) => {
    if (!enabled) return
    setActiveTool(toolId)
    if (onToolSelected) {
      onToolSelected(toolId)
    }
  }

  return (
    <div className="d3-viewport-toolbar">
      {tools.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`d3-viewport-toolbar-btn ${activeTool === t.id ? 'd3-viewport-toolbar-btn--selected' : ''}`}
          onClick={() => handleToolClick(t.id, t.enabled)}
          disabled={!t.enabled}
          title={t.label}
        >
          <span>{t.icon}</span>
        </button>
      ))}
    </div>
  )
}
export default ViewportToolbar
