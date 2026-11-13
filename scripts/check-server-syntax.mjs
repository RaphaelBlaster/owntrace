import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

function listJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listJavaScriptFiles(path)
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : []
  })
}

for (const file of listJavaScriptFiles('server/src')) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}
