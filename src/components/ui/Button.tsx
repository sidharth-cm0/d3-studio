/**
 * D3 STUDIO — Button System
 *
 * Hierarchy:
 *   PRIMARY   — Generate (high-emphasis CTA)
 *   SECONDARY — Play / Export
 *   TERTIARY  — camera / gestures / utilities
 *   DANGER    — Stop / delete only
 *   GHOST     — no background, border only
 *
 * Reuses the design-system CSS variables defined in src/styles/design-system.css.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './Button.css'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'danger'
  | 'ghost'

export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  children: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  const classes = [
    'd3-btn',
    `d3-btn--${variant}`,
    `d3-btn--${size}`,
    icon ? 'd3-btn--icon' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type="button" className={classes} {...rest}>
      {icon && <span className="d3-btn__icon">{icon}</span>}
      <span className="d3-btn__label">{children}</span>
    </button>
  )
}

export default Button
