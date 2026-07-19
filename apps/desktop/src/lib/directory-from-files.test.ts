import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  directoryPathFromFileList,
  isAbsoluteFsPath,
  type ElectronFile,
} from './directory-from-files.js'

function fakeFile(path: string, webkitRelativePath: string): ElectronFile {
  return { path, webkitRelativePath } as ElectronFile
}

describe('isAbsoluteFsPath', () => {
  it('detects unix and windows abs paths', () => {
    assert.equal(isAbsoluteFsPath('/Users/me'), true)
    assert.equal(isAbsoluteFsPath('C:\\Users\\me'), true)
    assert.equal(isAbsoluteFsPath('MyProj'), false)
  })
})

describe('directoryPathFromFileList', () => {
  it('returns null for empty list', () => {
    assert.equal(directoryPathFromFileList(null), null)
    assert.equal(directoryPathFromFileList([]), null)
  })

  it('extracts selected root from File.path + webkitRelativePath', () => {
    const files = [
      fakeFile('/Users/me/MyProj/src/index.ts', 'MyProj/src/index.ts'),
      fakeFile('/Users/me/MyProj/package.json', 'MyProj/package.json'),
    ]
    assert.equal(directoryPathFromFileList(files), '/Users/me/MyProj')
  })

  it('uses resolveAbsPath when File.path is missing (webUtils path)', () => {
    const files = [{ webkitRelativePath: 'swarmdesk-agent/README.md' } as ElectronFile]
    const dir = directoryPathFromFileList(
      files,
      () => '/Users/me/workspace/swarmdesk-agent/README.md',
    )
    assert.equal(dir, '/Users/me/workspace/swarmdesk-agent')
  })

  it('handles file directly under selected root', () => {
    const files = [fakeFile('/Users/me/swarmdesk-agent/README.md', 'swarmdesk-agent/README.md')]
    assert.equal(directoryPathFromFileList(files), '/Users/me/swarmdesk-agent')
  })

  it('falls back to dirname when no relative path', () => {
    const files = [fakeFile('/tmp/proj/a.txt', '')]
    assert.equal(directoryPathFromFileList(files), '/tmp/proj')
  })

  it('returns null when only relative name exists (cannot open project)', () => {
    const files = [{ webkitRelativePath: 'MyProj/a.ts' } as ElectronFile]
    assert.equal(directoryPathFromFileList(files), null)
  })
})
