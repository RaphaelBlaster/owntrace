import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { MongoMemoryServer } from 'mongodb-memory-server'

const serveMode = process.argv.includes('--serve')
const port = serveMode ? 5000 : 5055
const baseUrl = `http://127.0.0.1:${port}`
const mongoServer = await MongoMemoryServer.create()
const tokenEncryptionKey = Buffer.alloc(32, 4).toString('base64')
const sensitiveMarkers = [
  'smoke-google-client-secret',
  'smoke-jwt-secret',
  tokenEncryptionKey,
]

const child = spawn(process.execPath, ['src/server.js'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    CLIENT_APP_URL: serveMode ? 'http://localhost:5173' : 'https://app.owntrace.example',
    CLIENT_ORIGINS: serveMode ? 'http://localhost:5173' : 'https://app.owntrace.example',
    GOOGLE_CLIENT_ID: 'smoke-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: sensitiveMarkers[0],
    MICROSOFT_CLIENT_ID: '',
    MICROSOFT_CLIENT_SECRET: '',
    MICROSOFT_REDIRECT_URI: '',
    GOOGLE_REDIRECT_URI: serveMode
      ? 'http://localhost:5000/api/google/oauth/callback'
      : 'https://app.owntrace.example/api/google/oauth/callback',
    JWT_SECRET: `${sensitiveMarkers[1]}-${randomBytes(32).toString('base64url')}`,
    LOG_LEVEL: 'info',
    MONGO_URI: mongoServer.getUri(),
    NODE_ENV: serveMode ? 'development' : 'production',
    PORT: String(port),
    SHUTDOWN_TIMEOUT_MS: '5000',
    TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
    TRUST_PROXY: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
})

let output = ''
child.stdout.on('data', (chunk) => { output += chunk.toString() })
child.stderr.on('data', (chunk) => { output += chunk.toString() })

async function waitForReadiness() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health/ready`)
      if (response.ok) return
    } catch {
      // The process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Production server did not become ready. Output: ${output}`)
}

async function expectResponse(path, expectedStatus, expectedContentType) {
  const response = await fetch(`${baseUrl}${path}`)
  if (response.status !== expectedStatus) {
    throw new Error(`${path} returned ${response.status}; expected ${expectedStatus}`)
  }
  if (!response.headers.get('content-type')?.includes(expectedContentType)) {
    throw new Error(`${path} did not return ${expectedContentType}`)
  }
  if (!response.headers.get('x-request-id')) throw new Error(`${path} has no request ID`)
  return response
}

async function runLoadCheck() {
  const durations = await Promise.all(Array.from({ length: 100 }, async () => {
    const startedAt = performance.now()
    await expectResponse('/api/health', 200, 'application/json')
    return performance.now() - startedAt
  }))
  durations.sort((left, right) => left - right)
  const p95Ms = durations[Math.ceil(durations.length * 0.95) - 1]
  if (p95Ms >= 1_000) throw new Error(`Local health p95 ${Math.round(p95Ms)}ms exceeds 1000ms`)
  return Math.round(p95Ms)
}

async function waitForExit() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Production server did not shut down')), 8_000)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code !== 0) reject(new Error(`Production server exited with ${code}. Output: ${output}`))
      else resolve()
    })
  })
}

if (serveMode) {
  await waitForReadiness()
  process.stdout.write(`Production test server ready at ${baseUrl}\n`)
  await new Promise((resolve) => {
    const stop = () => {
      child.send('owntrace:shutdown')
      child.once('exit', resolve)
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  await mongoServer.stop()
  process.exit(0)
}

try {
  await waitForReadiness()
  const live = await expectResponse('/api/health', 200, 'application/json')
  if (!live.headers.get('content-security-policy')) throw new Error('Helmet CSP is missing')
  await expectResponse('/api/health/ready', 200, 'application/json')
  await expectResponse('/api/not-a-route', 401, 'application/json')
  const home = await expectResponse('/', 200, 'text/html')
  if (home.headers.has('ratelimit')) throw new Error('Static pages must not consume the API rate limit')
  await expectResponse('/privacy-policy', 200, 'text/html')
  await expectResponse('/terms', 200, 'text/html')
  const p95Ms = await runLoadCheck()

  sensitiveMarkers.forEach((marker) => {
    if (output.includes(marker)) throw new Error('A sensitive marker appeared in server logs')
  })

  child.send('owntrace:shutdown')
  await waitForExit()
  if (!output.includes('server_shutdown_completed')) {
    throw new Error(`Graceful shutdown was not logged. Output: ${output}`)
  }
  process.stdout.write(`Production smoke passed; local health p95=${p95Ms}ms\n`)
} finally {
  if (!child.killed) child.kill('SIGKILL')
  await mongoServer.stop()
}
