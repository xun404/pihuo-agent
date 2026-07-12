/**
 * Router Agents — GUI mockup interactions
 * Style: hifi | wire
 * Screens: empty | active | approval | workers
 */

(function () {
  const body = document.body
  const styleSeg = document.getElementById('styleSeg')
  const screenSeg = document.getElementById('screenSeg')
  const rightTabs = document.getElementById('rightTabs')
  const modePills = document.getElementById('modePills')
  const approvalModal = document.getElementById('approvalModal')
  const approvalInline = document.getElementById('approvalInline')
  const emptyState = document.getElementById('emptyState')
  const activeSession = document.getElementById('activeSession')
  const workerForm = document.getElementById('workerForm')
  const addWorkerBtn = document.getElementById('addWorkerBtn')
  const statusHint = document.getElementById('statusHint')
  const chatScroll = document.getElementById('chatScroll')

  function setStyle(style) {
    body.classList.toggle('wireframe', style === 'wire')
    styleSeg.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.style === style)
    })
    localStorage.setItem('ra-gui-style', style)
  }

  function activateRightTab(tab) {
    rightTabs.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab)
    })
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('active', p.dataset.panel === tab)
    })
  }

  function setScreen(screen) {
    body.dataset.screen = screen
    screenSeg.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.screen === screen)
    })

    const isEmpty = screen === 'empty'
    emptyState.classList.toggle('hidden', !isEmpty)
    activeSession.classList.toggle('hidden', isEmpty)
    if (isEmpty) {
      emptyState.style.display = 'flex'
      activeSession.style.display = 'none'
    } else {
      emptyState.style.display = 'none'
      activeSession.style.display = 'flex'
    }

    // Reset modal / form
    approvalModal.classList.remove('show')
    workerForm.classList.add('hidden')
    approvalInline.classList.add('hidden')

    if (screen === 'empty') {
      statusHint.textContent = 'No project · idle'
    }

    if (screen === 'active') {
      activateRightTab('workers')
      statusHint.textContent = 'Build mode · streaming'
      if (chatScroll) chatScroll.scrollTop = chatScroll.scrollHeight
    }

    if (screen === 'approval') {
      activateRightTab('approvals')
      approvalInline.classList.remove('hidden')
      approvalModal.classList.add('show')
      statusHint.textContent = 'Waiting for permission'
      if (chatScroll) {
        requestAnimationFrame(() => {
          chatScroll.scrollTop = chatScroll.scrollHeight
        })
      }
    }

    if (screen === 'workers') {
      activateRightTab('workers')
      workerForm.classList.remove('hidden')
      statusHint.textContent = 'Worker registry'
    }

    localStorage.setItem('ra-gui-screen', screen)
  }

  // Style toggle
  styleSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-style]')
    if (!btn) return
    setStyle(btn.dataset.style)
  })

  // Screen toggle
  screenSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-screen]')
    if (!btn) return
    setScreen(btn.dataset.screen)
  })

  // Right tabs
  rightTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]')
    if (!btn) return
    activateRightTab(btn.dataset.tab)
  })

  // Mode pills
  if (modePills) {
    modePills.addEventListener('click', (e) => {
      const btn = e.target.closest('button')
      if (!btn) return
      modePills.querySelectorAll('button').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      statusHint.textContent = `${btn.textContent} mode`
    })
  }

  // Worker toggles
  document.querySelectorAll('.toggle').forEach((el) => {
    el.addEventListener('click', () => {
      el.classList.toggle('on')
    })
  })

  // Project collapse
  document.querySelectorAll('.project-head').forEach((head) => {
    head.addEventListener('click', () => {
      head.closest('.project').classList.toggle('collapsed')
    })
  })

  // Session select
  document.querySelectorAll('.session-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.session-item').forEach((s) => s.classList.remove('active'))
      item.classList.add('active')
      if (body.dataset.screen === 'empty') setScreen('active')
    })
  })

  // Modal close
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      approvalModal.classList.remove('show')
      statusHint.textContent = 'Build mode · streaming'
    })
  })

  approvalModal.addEventListener('click', (e) => {
    if (e.target === approvalModal) {
      approvalModal.classList.remove('show')
    }
  })

  if (addWorkerBtn) {
    addWorkerBtn.addEventListener('click', () => {
      workerForm.classList.toggle('hidden')
      activateRightTab('workers')
    })
  }

  // Restore prefs
  const savedStyle = localStorage.getItem('ra-gui-style') || 'hifi'
  const savedScreen = localStorage.getItem('ra-gui-screen') || 'active'
  setStyle(savedStyle)
  setScreen(savedScreen)

  // Keyboard: 1-4 screens, W wireframe
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return
    if (e.key === '1') setScreen('empty')
    if (e.key === '2') setScreen('active')
    if (e.key === '3') setScreen('approval')
    if (e.key === '4') setScreen('workers')
    if (e.key === 'w' || e.key === 'W') {
      setStyle(body.classList.contains('wireframe') ? 'hifi' : 'wire')
    }
  })
})()
