/**
 * Fenced markdown code block: language label, line numbers, syntax highlight.
 * Uses the same lightweight tokenizer as the diff viewer.
 */
import { memo, useCallback, useMemo, useState } from 'react'
import { Check, Copy, WrapText } from 'lucide-react'
import { useI18n } from '../../i18n/I18nProvider'
import { highlightLine } from '../../lib/diff-syntax-highlight'

type Props = {
  code: string
  language?: string | null
  className?: string
}

function normalizeLang(raw: string | null | undefined): string {
  if (!raw) return ''
  const s = raw.trim().toLowerCase()
  if (!s || s === 'text' || s === 'plain' || s === 'plaintext') return ''
  // common aliases
  if (s === 'typescript' || s === 'ts') return 'ts'
  if (s === 'javascript' || s === 'js' || s === 'jsx') return 'js'
  if (s === 'tsx') return 'tsx'
  if (s === 'python' || s === 'py') return 'py'
  if (s === 'shell' || s === 'bash' || s === 'zsh' || s === 'sh') return 'sh'
  if (s === 'golang') return 'go'
  if (s === 'rust') return 'rs'
  if (s === 'csharp' || s === 'c#') return 'cs'
  if (s === 'c++' || s === 'cpp') return 'cpp'
  return s
}

function displayLang(lang: string): string {
  if (!lang) return 'text'
  const map: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TSX',
    js: 'JavaScript',
    jsx: 'JSX',
    py: 'Python',
    sh: 'Shell',
    go: 'Go',
    rs: 'Rust',
    java: 'Java',
    json: 'JSON',
    css: 'CSS',
    scss: 'SCSS',
    md: 'Markdown',
    html: 'HTML',
    xml: 'XML',
    sql: 'SQL',
    yaml: 'YAML',
    yml: 'YAML',
    toml: 'TOML',
    cs: 'C#',
    cpp: 'C++',
    c: 'C',
  }
  return map[lang] ?? lang
}

function renderTokens(line: string, lang: string) {
  const tokens = highlightLine(line, lang || 'text')
  return tokens.map((tok, i) =>
    tok.type === 'text' ? (
      <span key={i}>{tok.text}</span>
    ) : (
      <span key={i} className={`syn syn-${tok.type}`}>
        {tok.text}
      </span>
    ),
  )
}

function MdCodeBlockImpl({ code, language, className }: Props) {
  const { t } = useI18n()
  const lang = useMemo(() => normalizeLang(language), [language])
  const lines = useMemo(() => {
    // Drop trailing fence newline that react-markdown leaves on
    const raw = code.replace(/\n$/, '')
    return raw.length === 0 ? [''] : raw.split('\n')
  }, [code])
  const [copied, setCopied] = useState(false)
  // Ephemeral: default no wrap; not persisted across remounts / sessions
  const [wrap, setWrap] = useState(false)

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code.replace(/\n$/, ''))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* ignore */
    }
  }, [code])

  const gutterDigits = String(lines.length).length

  return (
    <div
      className={`md-code-block-wrap${wrap ? ' is-wrap' : ' is-nowrap'}${className ? ` ${className}` : ''}`}
      data-lang={lang || 'text'}
    >
      <div className="md-code-block-head">
        <span className="md-code-block-lang">{displayLang(lang)}</span>
        <div className="md-code-block-actions">
          <button
            type="button"
            className={`md-code-block-action${wrap ? ' is-on' : ''}`}
            onClick={() => setWrap((v) => !v)}
            aria-pressed={wrap}
            title={t('chat.diff.wrap')}
          >
            <WrapText size={13} aria-hidden />
            <span>{t('chat.diff.wrapShort')}</span>
          </button>
          <button
            type="button"
            className={`md-code-block-action md-code-block-copy${copied ? ' is-copied' : ''}`}
            onClick={() => void onCopy()}
            aria-label={copied ? 'Copied' : 'Copy code'}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
      <pre
        className={`md-code-block${wrap ? ' is-wrap' : ' is-nowrap'}`}
        style={{ ['--md-gutter-ch' as string]: `${gutterDigits}ch` }}
      >
        {lines.map((line, i) => (
          <div key={i} className="md-code-line">
            <span className="md-code-ln" aria-hidden>
              {i + 1}
            </span>
            <code className="md-code-src">{renderTokens(line, lang)}</code>
          </div>
        ))}
      </pre>
    </div>
  )
}

export const MdCodeBlock = memo(MdCodeBlockImpl)
