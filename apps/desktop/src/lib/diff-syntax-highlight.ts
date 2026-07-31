/**
 * Lightweight line syntax highlighter for the diff viewer (no highlight.js).
 * Tokenizes common languages well enough for Java/TS/JS/Python/Go/Rust/etc.
 */

export type SyntaxToken = { type: string; text: string }

const KEYWORDS = new Set(
  [
    // C-family / Java / TS / JS / C# / Go / Rust-ish
    'abstract',
    'as',
    'assert',
    'async',
    'await',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'default',
    'do',
    'else',
    'enum',
    'export',
    'extends',
    'false',
    'final',
    'finally',
    'for',
    'from',
    'function',
    'goto',
    'if',
    'implements',
    'import',
    'in',
    'instanceof',
    'interface',
    'let',
    'new',
    'null',
    'of',
    'package',
    'private',
    'protected',
    'public',
    'return',
    'static',
    'super',
    'switch',
    'this',
    'throw',
    'throws',
    'true',
    'try',
    'type',
    'typeof',
    'var',
    'void',
    'while',
    'with',
    'yield',
    // Java extras
    'boolean',
    'byte',
    'char',
    'double',
    'float',
    'int',
    'long',
    'short',
    'synchronized',
    'transient',
    'volatile',
    'native',
    'strictfp',
    // TS
    'declare',
    'keyof',
    'namespace',
    'readonly',
    'satisfies',
    // Python
    'def',
    'elif',
    'except',
    'lambda',
    'None',
    'True',
    'False',
    'pass',
    'raise',
    'self',
    // Go / Rust
    'fn',
    'func',
    'impl',
    'mut',
    'pub',
    'struct',
    'trait',
    'use',
  ].map((k) => k),
)

/** Guess language from path extension. */
export function languageFromPath(path: string | null | undefined): string {
  if (!path) return 'text'
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/)
  const ext = m?.[1] ?? ''
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return 'ts'
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'js'
    case 'java':
      return 'java'
    case 'py':
      return 'py'
    case 'go':
      return 'go'
    case 'rs':
      return 'rs'
    case 'css':
    case 'scss':
      return 'css'
    case 'json':
      return 'json'
    case 'md':
      return 'md'
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'sh'
    default:
      return 'text'
  }
}

/**
 * Tokenize one source line into highlight spans.
 * Intentionally line-local (diff is rendered line-by-line).
 */
export function highlightLine(line: string, _lang = 'text'): SyntaxToken[] {
  if (!line) return [{ type: 'text', text: '' }]
  const tokens: SyntaxToken[] = []
  let i = 0
  const n = line.length

  const push = (type: string, text: string) => {
    if (!text) return
    const last = tokens[tokens.length - 1]
    if (last && last.type === type) last.text += text
    else tokens.push({ type, text })
  }

  while (i < n) {
    const ch = line[i]!

    // line comment
    if (ch === '/' && line[i + 1] === '/') {
      push('comment', line.slice(i))
      break
    }
    if (ch === '#') {
      push('comment', line.slice(i))
      break
    }

    // string
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      let j = i + 1
      while (j < n) {
        if (line[j] === '\\') {
          j += 2
          continue
        }
        if (line[j] === quote) {
          j++
          break
        }
        j++
      }
      push('string', line.slice(i, j))
      i = j
      continue
    }

    // number
    if (/\d/.test(ch) && (i === 0 || /[^\w$]/.test(line[i - 1] ?? ' '))) {
      let j = i
      while (j < n && /[\d._xXa-fA-F]/.test(line[j]!)) j++
      push('number', line.slice(i, j))
      i = j
      continue
    }

    // identifier / keyword
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1
      while (j < n && /[\w$]/.test(line[j]!)) j++
      const word = line.slice(i, j)
      if (KEYWORDS.has(word)) push('keyword', word)
      else if (/^[A-Z][A-Za-z0-9_]*$/.test(word)) push('type', word)
      else if (j < n && line[j] === '(') push('function', word)
      else push('ident', word)
      i = j
      continue
    }

    // operators / punctuation
    if (/[+\-*/%=<>!&|^~?:;,.()[\]{}]/.test(ch)) {
      let j = i + 1
      // multi-char ops
      while (j < n && /[+\-*/%=<>!&|^~?:]/.test(line[j]!)) j++
      push('punct', line.slice(i, j))
      i = j
      continue
    }

    // whitespace / other
    let j = i + 1
    while (j < n && !/[A-Za-z0-9_$#"'`+\-*/%=<>!&|^~?:;,.()[\]{}]/.test(line[j]!)) j++
    push('text', line.slice(i, j))
    i = j
  }

  return tokens
}
