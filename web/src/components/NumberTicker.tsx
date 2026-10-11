import { useEffect, useRef, useState } from 'react'
import { animate } from 'motion/react'
import { cn } from '@/lib/utils'

interface Props {
  value: number
  decimals?: number
  prefix?: string
  suffix?: string
  /** custom formatter for the animated number (e.g. m:ss clocks) */
  format?: (n: number) => string
  className?: string
  duration?: number
}

/** Animated count-up number (Magic UI NumberTicker pattern, re-implemented on `motion`'s animate()). */
export function NumberTicker({ value, decimals = 0, prefix = '', suffix = '', format, className, duration = 1.1 }: Props) {
  const [display, setDisplay] = useState(0)
  const prev = useRef(0)

  useEffect(() => {
    const from = prev.current
    const controls = animate(from, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
    })
    prev.current = value
    return () => controls.stop()
  }, [value, duration])

  const text = format
    ? format(display)
    : display.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

  return (
    <span className={cn('tabular', className)}>
      {prefix}
      {text}
      {suffix}
    </span>
  )
}
