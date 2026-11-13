import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/app.js'
import Session from '../src/models/session.model.js'

afterEach(() => vi.restoreAllMocks())

async function signIn() {
  const agent = request.agent(app)
  const registration = await agent.post('/api/auth/register').send({
    name: 'Resilience test', email: 'resilience@example.com', password: 'test-only-long-password',
  }).expect(201)
  return { agent, cookie: registration.headers['set-cookie'][0].split(';')[0] }
}

describe('session storage failure recovery', () => {
  it.each(['/api/auth/session', '/api/auth/me', '/api/accounts'])('preserves a valid session when storage fails at %s', async (path) => {
    const { agent } = await signIn()
    const failure = vi.spyOn(Session, 'exists').mockRejectedValueOnce(new Error('test database unavailable'))
    const response = await agent.get(path).expect(503)
    expect(response.body.code).toBe('SESSION_UNAVAILABLE')
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(JSON.stringify(response.body)).not.toContain('test database')
    failure.mockRestore()
    const recovered = await agent.get('/api/auth/session').expect(200)
    expect(recovered.body.user.email).toBe('resilience@example.com')
  })

  it('does not claim logout succeeded when revocation failed, and allows a retry', async () => {
    const { agent, cookie } = await signIn()
    const failure = vi.spyOn(Session, 'deleteOne').mockRejectedValueOnce(new Error('test database unavailable'))
    const response = await agent.post('/api/auth/logout').expect(503)
    expect(response.body.code).toBe('SESSION_UNAVAILABLE')
    expect(response.headers['set-cookie']).toBeUndefined()
    failure.mockRestore()
    await agent.post('/api/auth/logout').expect(200)
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401)
  })
})
