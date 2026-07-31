import { memo, useMemo } from 'react'
import { highlightLine, languageFromPath } from '../../lib/diff-syntax-highlight'

type Props = {
  code: string
  filePath?: string | null
  className?: string
  title?: string
}

function DiffCodeImpl({ code, filePath, className, title }: Props) {
  const lang = useMemo(() => languageFromPath(filePath), [filePath])
  const tokens = useMemo(() => highlightLine(code, lang), [code, lang])

  if (!code) return <span className={className} />

  // block-level so flex parents + pre-wrap actually break lines in side-by-side
  return (
    <span className={className} title={title} style={{ display: 'block', width: '100%' }}>
      {tokens.map((tok, i) =>
        tok.type === 'text' ? (
          <span key={i}>{tok.text}</span>
        ) : (
          <span key={i} className={`syn syn-${tok.type}`}>
            {tok.text}
          </span>
        ),
      )}
    </span>
  )
}

export const DiffCode = memo(DiffCodeImpl)
