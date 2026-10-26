import request from 'supertest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import app from '../src/app.js'
import User from '../src/models/user.model.js'
import { hasTraceConsent } from '../src/services/trace-decision-config.js'
beforeEach(() => { vi.stubEnv('TRACE_PROVIDER', 'inception'); vi.stubEnv('TYPESAFE_API_KEY', ''); vi.stubEnv('INCEPTION_API_KEY', 'chat-test') })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
it.each([1, 2])('preserves existing provider consent version %s without requiring Jev', async version => {
  const agent = request.agent(app)
  const registered = await agent.post('/api/auth/register').send({ name: 'Consent tester', email: 'consent-'+version+'@example.com', password: 'a secure test password' }).expect(201)
  await User.updateOne({ _id: registered.body.user.id }, { onboardingStatus: 'COMPLETED', traceAiConsent: { provider: 'inception', version, acceptedAt: new Date() } })
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const status = await agent.get('/api/trace/status').expect(200)
  expect(status.body).toMatchObject({ configured: true, provider: 'inception', consentEnabled: true })
  expect(status.body.decisionProvider).toBeUndefined()
  expect(fetch).not.toHaveBeenCalled()
  await agent.put('/api/trace/consent').send({ enabled: false }).expect(200)
  expect((await agent.get('/api/trace/status')).body.consentEnabled).toBe(false)
})
it('does not reuse consent for a different provider or withdrawn consent', () => {
  const user = { traceAiConsent: { provider: 'inception', version: 2, acceptedAt: new Date() } }
  expect(hasTraceConsent(user, 'azure')).toBe(false)
  expect(hasTraceConsent({ traceAiConsent: { ...user.traceAiConsent, acceptedAt: null } }, 'inception')).toBe(false)
})
