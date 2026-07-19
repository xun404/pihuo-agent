// Apply the saved theme + palette before React mounts (no inline script / CSP-safe).
// Appearance presets: system → classic light / dark; classic → light classic; warm → light warm; dark → dark.
try {
  const mode = localStorage.getItem('swarmdesk-agent.theme') || 'system'
  const dark =
    mode === 'dark' ||
    (mode !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const theme = dark ? 'dark' : 'light'
  // system 浅色固定经典；仅显式 warm 才用暖橙
  let palette: 'warm' | 'classic' = 'classic'
  if (mode === 'light') {
    const paletteRaw = localStorage.getItem('swarmdesk-agent.palette')
    palette = paletteRaw === 'warm' ? 'warm' : 'classic'
  } else if (mode === 'system') {
    palette = 'classic'
  }

  document.documentElement.dataset.theme = theme
  document.documentElement.dataset.palette = palette
  document.documentElement.style.colorScheme = theme
} catch {
  // localStorage may be unavailable; CSS defaults apply.
}

export {}
