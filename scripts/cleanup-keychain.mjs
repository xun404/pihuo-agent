#!/usr/bin/env node
/**
 * One-shot cleanup of legacy macOS Keychain entries left by the old safeStorage
 * integration. Router Agents no longer uses safeStorage (the master key is now
 * derived from the machine identity), so these entries are dead weight and the
 * reason the OS used to prompt for keychain access on every launch.
 *
 * Usage:
 *   node scripts/cleanup-keychain.mjs          # dry-run (lists entries only)
 *   node scripts/cleanup-keychain.mjs --apply  # actually delete
 *
 * macOS only. On Linux/Windows this is a no-op.
 */

import { execSync } from 'node:child_process'

const SERVICE_NAMES = ['@router-agents/desktop Safe Storage', 'router-agents Safe Storage']

function isMacos() {
  return process.platform === 'darwin'
}

function findEntries(service) {
  try {
    // Do NOT use -g here: it requests the password and triggers a keychain
    // unlock prompt. A bare find only reads metadata.
    execSync(`security find-generic-password -s ${JSON.stringify(service)}`, {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function deleteEntry(service) {
  try {
    execSync(`security delete-generic-password -s ${JSON.stringify(service)}`, {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function main() {
  if (!isMacos()) {
    console.log('cleanup-keychain: not macOS, nothing to do.')
    return
  }

  const apply = process.argv.includes('--apply')
  console.log(apply ? 'Mode: APPLY (deleting entries)' : 'Mode: DRY-RUN (use --apply to delete)')

  let found = 0
  let deleted = 0
  for (const service of SERVICE_NAMES) {
    if (!findEntries(service)) {
      console.log(`  [skip]  no entry for "${service}"`)
      continue
    }
    found += 1
    if (!apply) {
      console.log(`  [found] "${service}" (would delete with --apply)`)
      continue
    }
    if (deleteEntry(service)) {
      console.log(`  [deleted] "${service}"`)
      deleted += 1
    } else {
      console.log(`  [error]  failed to delete "${service}" (may require keychain unlock)`)
    }
  }

  if (found === 0) {
    console.log('No legacy safeStorage entries found. Keychain is already clean.')
  } else if (apply) {
    console.log(`Deleted ${deleted} of ${found} entries.`)
  } else {
    console.log(`Found ${found} entries. Re-run with --apply to remove them.`)
  }
}

main()
