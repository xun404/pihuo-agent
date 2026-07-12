/**
 * Wire Electron safeStorage (macOS Keychain / Windows DPAPI) as master-key wrapper.
 * The secrets payload itself stays AES-GCM encrypted on disk under ~/.router-agents.
 */
import { safeStorage } from 'electron'
import { setMasterKeyProvider } from '@router-agents/core'

export function installElectronSafeStorage(): void {
  setMasterKeyProvider({
    isAvailable: () => {
      try {
        return safeStorage.isEncryptionAvailable()
      } catch {
        return false
      }
    },
    wrapMasterKey: (raw: Buffer) => {
      try {
        if (!safeStorage.isEncryptionAvailable()) return null
        // safeStorage encrypts utf8 strings — use base64 for binary key
        const b64 = raw.toString('base64')
        return safeStorage.encryptString(b64)
      } catch (e) {
        console.warn('[secure-bridge] wrap failed', e)
        return null
      }
    },
    unwrapMasterKey: (wrapped: Buffer) => {
      try {
        if (!safeStorage.isEncryptionAvailable()) return null
        const b64 = safeStorage.decryptString(wrapped)
        return Buffer.from(b64, 'base64')
      } catch (e) {
        console.warn('[secure-bridge] unwrap failed', e)
        return null
      }
    },
  })
  console.log(
    '[secure-bridge] safeStorage available:',
    safeStorage.isEncryptionAvailable(),
  )
}
