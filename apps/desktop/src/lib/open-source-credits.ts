/**
 * Curated open-source projects used by PiHuo (runtime + primary UI stack).
 * Plain English list — no i18n; maintain entries here only.
 */
export type OpenSourceCredit = {
  name: string
  role: string
  license: string
  url: string
}

export const OPEN_SOURCE_CREDITS: OpenSourceCredit[] = [
  {
    name: 'Electron',
    role: 'Desktop shell',
    license: 'MIT',
    url: 'https://www.electronjs.org/',
  },
  {
    name: 'React',
    role: 'UI',
    license: 'MIT',
    url: 'https://react.dev/',
  },
  {
    name: 'Vite',
    role: 'Dev / bundler',
    license: 'MIT',
    url: 'https://vitejs.dev/',
  },
  {
    name: 'Pi Coding Agent',
    role: 'Leader runtime',
    license: 'MIT',
    url: 'https://pi.dev/',
  },
  {
    name: 'Agent Client Protocol',
    role: 'CLI worker protocol',
    license: 'Apache-2.0',
    url: 'https://agentclientprotocol.com/',
  },
  {
    name: 'Framer Motion',
    role: 'Motion',
    license: 'MIT',
    url: 'https://www.framer.com/motion/',
  },
  {
    name: 'Lucide',
    role: 'Icons',
    license: 'ISC',
    url: 'https://lucide.dev/',
  },
  {
    name: 'react-markdown',
    role: 'Markdown rendering',
    license: 'MIT',
    url: 'https://github.com/remarkjs/react-markdown',
  },
  {
    name: 'remark-gfm',
    role: 'GitHub-flavored markdown',
    license: 'MIT',
    url: 'https://github.com/remarkjs/remark-gfm',
  },
  {
    name: 'xterm.js',
    role: 'Terminal UI',
    license: 'MIT',
    url: 'https://xtermjs.org/',
  },
  {
    name: 'node-pty',
    role: 'Pseudo-terminals',
    license: 'MIT',
    url: 'https://github.com/microsoft/node-pty',
  },
  {
    name: 'Zod',
    role: 'Schema validation',
    license: 'MIT',
    url: 'https://zod.dev/',
  },
  {
    name: 'ws',
    role: 'WebSocket',
    license: 'MIT',
    url: 'https://github.com/websockets/ws',
  },
  {
    name: 'Ajv',
    role: 'JSON Schema',
    license: 'MIT',
    url: 'https://ajv.js.org/',
  },
  {
    name: 'yauzl',
    role: 'ZIP extraction',
    license: 'MIT',
    url: 'https://github.com/thejoshwolfe/yauzl',
  },
  {
    name: 'tar-stream',
    role: 'Tar streaming',
    license: 'MIT',
    url: 'https://github.com/mafintosh/tar-stream',
  },
]
