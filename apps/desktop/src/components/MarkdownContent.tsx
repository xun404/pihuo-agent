import React, { memo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MdCodeBlock } from './chat/MdCodeBlock'
import { mentionifyChildren } from './chat/ImMentionText'
import { languageFromClassName } from '../lib/md-code-lang'

type Props = {
  children: string
  className?: string
  mentionNames?: readonly string[]
  onMentionClick?: (name: string) => void
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

function withMentions(
  names: readonly string[],
  onMentionClick?: (name: string) => void,
): Components {
  const chip = (children: ReactNode) => mentionifyChildren(children, names, onMentionClick)
  return {
    ...components,
    p: ({ children, node: _node, ...rest }) => <p {...rest}>{chip(children)}</p>,
    li: ({ children, node: _node, ...rest }) => <li {...rest}>{chip(children)}</li>,
    td: ({ children, node: _node, ...rest }) => <td {...rest}>{chip(children)}</td>,
    th: ({ children, node: _node, ...rest }) => <th {...rest}>{chip(children)}</th>,
    blockquote: ({ children, node: _node, ...rest }) => (
      <blockquote {...rest}>{chip(children)}</blockquote>
    ),
  }
}

/**
 * Render assistant chat text as GFM markdown (tables, lists, code fences, etc.).
 * Safe enough for model output: no raw HTML, links open in new tab.
 * Fenced code blocks get line numbers + lightweight syntax highlight.
 */
export const MarkdownContent = memo(function MarkdownContent({
  children,
  className,
  mentionNames = [],
  onMentionClick,
}: Props) {
  if (!children) return null
  const mdComponents =
    mentionNames.length > 0 ? withMentions(mentionNames, onMentionClick) : components
  return (
    <div className={`md-content${className ? ` ${className}` : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {children}
      </ReactMarkdown>
    </div>
  )
})
