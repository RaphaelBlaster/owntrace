import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import app from '../src/app.js'

it('allows the fixed company-logo host without allowing arbitrary image origins', async () => {
  const response = await request(app).get('/api/health')
  const images = response.headers['content-security-policy'].split(';').find(value => value.trim().startsWith('img-src'))
  expect(images).toContain('https://icons.duckduckgo.com')
  expect(images).not.toContain('*')
  expect(images).not.toMatch(/(?:^|\s)https:(?:\s|$)/)
})
import { getGoogleClientUrl } from '../src/config/google.js'
import {
  getRuntimeConfig,
  getTrustProxy,
  validateRuntimeEnvironment,
} from '../src/config/runtime.js'

const managedEnvironmentNames = [
  'BCRYPT_ROUNDS',
  'CLIENT_APP_URL',
  'CLIENT_ORIGINS',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CLIENT_APP_URL',
  'GOOGLE_REDIRECT_URI',
  'JWT_SECRET',
  'LOG_LEVEL',
  'MONGO_URI',
  'MICROSOFT_CLIENT_ID',
  'MICROSOFT_CLIENT_SECRET',
  'MICROSOFT_REDIRECT_URI',
  'MICROSOFT_SYNC_MESSAGE_LIMIT',
  'NODE_ENV',
  'PORT',
  'SHUTDOWN_TIMEOUT_MS',
  'TOKEN_ENCRYPTION_KEY',
  'TRUST_PROXY',
]

const originalEnvironment = Object.fromEntries(
  managedEnvironmentNames.map((name) => [name, process.env[name]]),
)

afterEach(() => {
  managedEnvironmentNames.forEach((name) => {
    if (originalEnvironment[name] === undefined) delete process.env[name]
    else process.env[name] = originalEnvironment[name]
  })
})

function configureValidProductionEnvironment() {
  Object.assign(process.env, {
    CLIENT_APP_URL: 'https://app.owntrace.example',
    CLIENT_ORIGINS: 'https://app.owntrace.example',
    GOOGLE_CLIENT_ID: 'production-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'not-a-real-client-secret',
    GOOGLE_REDIRECT_URI: 'https://app.owntrace.example/api/google/oauth/callback',
    JWT_SECRET: 'not-a-real-production-secret-with-at-least-32-characters',
    MONGO_URI: 'mongodb://database.example/owntrace',
    MICROSOFT_CLIENT_ID: 'production-microsoft-client-id',
    MICROSOFT_CLIENT_SECRET: 'not-a-real-microsoft-client-secret',
    MICROSOFT_REDIRECT_URI: 'https://app.owntrace.example/api/microsoft/oauth/callback',
    NODE_ENV: 'production',
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    TRUST_PROXY: '1',
  })
}

describe('runtime configuration and health', () => {
  it('supports a separate Google return origin while still validating the shared client origin', () => {
    configureValidProductionEnvironment()
    process.env.GOOGLE_CLIENT_APP_URL = 'https://google.owntrace.example'
    expect(getGoogleClientUrl()).toBe('https://google.owntrace.example')
    expect(validateRuntimeEnvironment().nodeEnvironment).toBe('production')
    process.env.GOOGLE_CLIENT_APP_URL = 'http://google.owntrace.example'
    expect(() => validateRuntimeEnvironment()).toThrow(/GOOGLE_CLIENT_APP_URL must use HTTPS/)
    process.env.GOOGLE_CLIENT_APP_URL = 'https://google.owntrace.example'
    process.env.CLIENT_APP_URL = 'http://app.owntrace.example'
    expect(() => validateRuntimeEnvironment()).toThrow(/CLIENT_APP_URL must use HTTPS/)
  })

  it('returns liveness, readiness, and an opaque request identifier', async () => {
    const live = await request(app).get('/api/health').expect(200)
    expect(live.body).toEqual({ message: 'OwnTrace API is running', success: true })
    expect(live.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )

    const ready = await request(app).get('/api/health/ready').expect(200)
    expect(ready.body).toEqual({ status: 'ready', success: true })
  })

  it('accepts an explicit production configuration without exposing its values', () => {
    configureValidProductionEnvironment()
    expect(validateRuntimeEnvironment()).toMatchObject({
      nodeEnvironment: 'production',
      port: 5000,
      trustProxy: 1,
    })
  })

  it('allows production with Google disabled while preserving encryption and HTTPS requirements',()=>{
    configureValidProductionEnvironment()
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    delete process.env.GOOGLE_REDIRECT_URI
    expect(validateRuntimeEnvironment().nodeEnvironment).toBe('production')
    process.env.TOKEN_ENCRYPTION_KEY='invalid'
    expect(()=>validateRuntimeEnvironment()).toThrow(/base64-encoded 32-byte key/)
  })

  it.each(['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'])('rejects partial Google configuration missing %s',name=>{
    configureValidProductionEnvironment()
    delete process.env[name]
    expect(()=>validateRuntimeEnvironment()).toThrow(new RegExp(name))
  })

  it.each([
    ['CLIENT_ORIGINS', 'http://app.owntrace.example', /CLIENT_ORIGINS must use HTTPS/],
    ['CLIENT_APP_URL', 'https://user:secret@app.owntrace.example', /must not contain credentials/],
    ['GOOGLE_REDIRECT_URI', 'http://app.owntrace.example/callback', /GOOGLE_REDIRECT_URI must use HTTPS/],
    ['TOKEN_ENCRYPTION_KEY', 'not-a-key', /base64-encoded 32-byte key/],
  ])('rejects unsafe production %s configuration', (name, value, expectedError) => {
    configureValidProductionEnvironment()
    process.env[name] = value
    expect(() => validateRuntimeEnvironment()).toThrow(expectedError)
  })

  it('rejects a missing database configuration and invalid proxy trust', () => {
    process.env.MONGO_URI = ''
    expect(() => validateRuntimeEnvironment()).toThrow('MONGO_URI must be configured')
    process.env.TRUST_PROXY = 'all-the-internet'
    expect(() => getTrustProxy()).toThrow(/TRUST_PROXY/)

    configureValidProductionEnvironment()
    process.env.TRUST_PROXY = 'true'
    expect(() => validateRuntimeEnvironment()).toThrow(/too broad for production/)
  })

  it('bounds numeric runtime controls and logging modes', () => {
    process.env.PORT = '70000'
    expect(() => getRuntimeConfig()).toThrow(/PORT/)
    process.env.PORT = '5000'
    process.env.LOG_LEVEL = 'debug-with-sensitive-data'
    expect(() => getRuntimeConfig()).toThrow(/LOG_LEVEL/)
  })

  it('rejects an invalid Microsoft sync message limit', () => {
    configureValidProductionEnvironment()
    process.env.MICROSOFT_SYNC_MESSAGE_LIMIT = '24'
    expect(() => validateRuntimeEnvironment()).toThrow(/MICROSOFT_SYNC_MESSAGE_LIMIT/)
  })
})
