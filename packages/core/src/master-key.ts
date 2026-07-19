/**
 * Master key derivation for secrets encryption.
 *
 * Strategy: derive the AES-256 master key from a stable
 * machine/account identifier instead of persisting it to disk or wrapping
 * it with OS keychain (safeStorage). This avoids the macOS keychain prompt
 * on every launch while still binding ciphertext to the local machine.
 *
 * Resolution priority:
 *   1. $SWARMDESK_AGENT_CREDENTIAL_SECRET — explicit override (CI / tests / power users)
 *   2. SHA-256(`swarmdesk-agent:<platform>:<username>:<homedir>`)
 *
 * Security property: ciphertext copied to another machine (or another user
 * account) cannot be decrypted because the derived key changes.
 */

import { createHash } from 'node:crypto'
import { homedir, userInfo, type UserInfo } from 'node:os'

const ENV_OVERRIDE = 'SWARMDESK_AGENT_CREDENTIAL_SECRET'

function sha256(input: string): Buffer {
  return createHash('sha256').update(input, 'utf8').digest()
}

function safeUserInfo(): UserInfo<{}> {
  try {
    return userInfo()
  } catch {
    // userInfo() can throw in unusual environments (e.g. missing passwd entry).
    return { username: 'unknown', uid: -1, gid: -1, shell: '', homedir: homedir() } as UserInfo<{}>
  }
}

/**
 * Derive the 32-byte AES-256 master key.
 *
 * @param env override `process.env` (for tests); reads SWARMDESK_AGENT_CREDENTIAL_SECRET
 * @param platform override `process.platform` (for tests)
 * @param home override homedir (for tests)
 */
export function deriveMasterKey(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  home: string = homedir(),
): Buffer {
  const secret = env[ENV_OVERRIDE]?.trim()
  if (secret) return sha256(secret)

  const user = safeUserInfo()
  // Bind to platform + OS username + home dir. Username + homedir together
  // disambiguate accounts on shared hosts; platform disambiguates cross-OS.
  const identity = `swarmdesk-agent:${platform}:${user.username}:${home}`
  return sha256(identity)
}
