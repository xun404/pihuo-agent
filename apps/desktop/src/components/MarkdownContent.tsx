import { memo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MdCodeBlock } from './chat/MdCodeBlock'
import { languageFromClassName } from '../lib/md-code-lang'

type Props = {
  children: string
  className?: string
}

const components: Components = {
  a: ({ href, children, ...rest }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
      {children}
    </a>
  ),
  // Fenced blocks are fully rendered by `code` (MdCodeBlock); unwrap outer <pre>.
  pre: ({ children }) => <>{children as ReactNode}</>,
  code: ({ className, children, ...rest }) => {
    const text = String(children)
    const langClass = Boolean(className?.includes('language-'))
    const isBlock = langClass || text.includes('\n')
    if (isBlock) {
      return (
        <MdCodeBlock
          code={text}
          language={languageFromClassName(className)}
          className={className}
        />
      )
    }
    return (
      <code className="md-code-inline" {...rest}>
        {children}
      </code>
    )
  },
  table: ({ children, ...rest }) => (
    <div className="md-table-wrap">
      <table {...rest}>{children}</table>
    </div>
  ),
}

/**
 * Render assistant chat text as GFM markdown (tables, lists, code fences, etc.).
 * Safe enough for model output: no raw HTML, links open in new tab.
 * Fenced code blocks get line numbers + lightweight syntax highlight.
 */
export const MarkdownContent = memo(function MarkdownContent({ children, className }: Props) {
  if (!children) return null
  return (
    <div className={`md-content${className ? ` ${className}` : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
})
