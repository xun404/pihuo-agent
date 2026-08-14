import { useRef, useState } from 'react'
import { documentPrefersReducedMotion } from '../lib/motion-preference'
import type { BrandAnimHandle } from './brand-bricks'
import { HuoMark } from './HuoMark'
import { PiLogoStage } from './PiLogoStage'

/**
 * Official Pi mark + brick Huo. One click plays Huo first, then the official
 * Pi drop. Huo hides while Pi plays so the wide tetromino board cannot fuse.
 */
export function BrandLockup({
  className,
  label,
  size = 24,
}: {
  className?: string
  label: string
  size?: number
}) {
  const piRef = useRef<BrandAnimHandle>(null)
  const huoRef = useRef<BrandAnimHandle>(null)
  const seqRef = useRef(0)
  const [phase, setPhase] = useState<'idle' | 'pi' | 'huo'>('idle')

  const runSequence = () => {
    if (documentPrefersReducedMotion()) return
    const token = ++seqRef.current
    piRef.current?.stop()
    huoRef.current?.stop()
    setPhase('huo')
    void (async () => {
      await huoRef.current?.play()
      if (token !== seqRef.current) return
      setPhase('pi')
      await piRef.current?.play(true)
      if (token !== seqRef.current) return
      setPhase('idle')
    })()
  }

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      data-phase={phase}
      style={{ ['--pi-size' as string]: `${size}px` }}
      onClick={runSequence}
    >
      <PiLogoStage ref={piRef} className="brand-pi-stage" size={size} label={label} controlled />
      <HuoMark ref={huoRef} className="brand-huo-word" size={size} title={label} controlled />
    </button>
  )
}
