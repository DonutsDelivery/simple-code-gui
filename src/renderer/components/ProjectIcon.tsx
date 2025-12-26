import React from 'react'
import { getProjectIcon } from '../utils/projectIcons'

interface ProjectIconProps {
  projectName: string
  size?: number
}

export function ProjectIcon({ projectName, size = 24 }: ProjectIconProps) {
  const icon = getProjectIcon(projectName)

  if (icon.emoji) {
    return (
      <span
        className="project-icon emoji"
        style={{ fontSize: size * 0.75 }}
        title={projectName}
      >
        {icon.emoji}
      </span>
    )
  }

  return (
    <span
      className="project-icon letter"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        backgroundColor: icon.color,
      }}
      title={projectName}
    >
      {icon.letter}
    </span>
  )
}
