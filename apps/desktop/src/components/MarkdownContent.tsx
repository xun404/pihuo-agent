import { memo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
  pre: ({ children, ...rest }) => (
    <pre className="md-pre" {...rest}>
      {children as ReactNode}
    </pre>
  ),
  code: ({ className, children, ...rest }) => {
    const text = String(children)
    const isBlock = Boolean(className?.includes('language-') || text.includes('\n'))
    if (isBlock) {
      return (
        <code className={`md-code-block ${className ?? ''}`} {...rest}>
          {children}
        </code>
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
