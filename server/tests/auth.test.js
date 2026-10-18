import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { google } from 'googleapis'
import request from 'supertest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import app from '../src/app.js'
import { TOKEN_AUDIENCE, TOKEN_ISSUER, getJwtSecret } from '../src/config/auth.js'
import { GMAIL_METADATA_SCOPE } from '../src/config/google.js'
import { requireTrustedOrigin } from '../src/middleware/security.middleware.js'
import AccountAction from '../src/models/account-action.model.js'
import AccountEvidence from '../src/models/account-evidence.model.js'
import Account from '../src/models/account.model.js'
import GoogleConnection from '../src/models/google-connection.model.js'
import GmailSignal from '../src/models/gmail-signal.model.js'
import GmailSyncJob from '../src/models/gmail-sync-job.model.js'
import MicrosoftConnection from '../src/models/microsoft-connection.model.js'
import MicrosoftSignal from '../src/models/microsoft-signal.model.js'
import MicrosoftSubscription from '../src/models/microsoft-subscription.model.js'
import MicrosoftSyncJob from '../src/models/microsoft-sync-job.model.js'
import Session from '../src/models/session.model.js'
import Subscription from '../src/models/subscription.model.js'
import User from '../src/models/user.model.js'
import { decryptSecret, encryptSecret } from '../src/utils/encryption.js'

const validRegistration = {
  name: 'Anas Example',
  email: 'anas@example.com',
  password: 'correct horse battery staple',
}

beforeAll(async () => {
  await Promise.all([
    User.init(),
    AccountAction.init(),
    Account.init(),
    AccountEvidence.init(),
    GoogleConnection.init(),
    GmailSignal.init(),
    GmailSyncJob.init(),
    MicrosoftConnection.init(),
    MicrosoftSignal.init(),
    MicrosoftSubscription.init(),
    MicrosoftSyncJob.init(),
    Session.init(),
    Subscription.init(),
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('authentication API', () => {
  describe('POST /api/auth/register', () => {
    it('creates a minimal user, hashes the password, and starts a cookie session', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .set('Origin', 'http://localhost:5173')
        .send({ ...validRegistration, email: '  ANAS@EXAMPLE.COM  ' })
        .expect(201)

      expect(response.body).toMatchObject({
        success: true,
        user: {
          authProviders: ['password'],
          email: 'anas@example.com',
          emailVerified: false,
          name: 'Anas Example',
          onboardingStatus: 'NOT_STARTED',
        },
      })
      expect(response.body.user).not.toHaveProperty('passwordHash')
      expect(response.headers['set-cookie'][0]).toContain('owntrace_session=')
      expect(response.headers['set-cookie'][0]).toContain('HttpOnly')
      expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax')
      expect(response.headers['set-cookie'][0]).not.toContain('Secure')

      const storedUser = await User.findOne({ email: 'anas@example.com' }).select('+passwordHash')
      expect(storedUser.passwordHash).not.toBe(validRegistration.password)
      expect(await bcrypt.compare(validRegistration.password, storedUser.passwordHash)).toBe(true)
    })

    it('rejects duplicate registration without exposing the stored user', async () => {
      await request(app).post('/api/auth/register').send(validRegistration).expect(201)

      const response = await request(app)
        .post('/api/auth/register')
        .send({ ...validRegistration, name: 'Another Name' })
        .expect(409)

      expect(response.body).toEqual({
        success: false,
        code: 'EMAIL_IN_USE',
        message: 'An account with this email already exists.',
      })
      expect(await User.countDocuments({ email: validRegistration.email })).toBe(1)
    })

    it.each([
      [{ ...validRegistration, name: '' }, 'name'],
      [{ ...validRegistration, email: 'not-an-email' }, 'email'],
      [{ ...validRegistration, password: 'too-short' }, 'password'],
    ])('returns field validation for invalid registration input', async (payload, field) => {
      const response = await request(app).post('/api/auth/register').send(payload).expect(400)

      expect(response.body.code).toBe('VALIDATION_ERROR')
      expect(response.body.errors).toHaveProperty(field)
    })

    it('rejects untrusted browser origins', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .set('Origin', 'https://attacker.example')
        .send(validRegistration)
        .expect(403)

      expect(response.body.code).toBe('ORIGIN_NOT_ALLOWED')
      expect(await User.countDocuments()).toBe(0)
    })

    it('rejects unsafe requests without an Origin outside the test bypass', () => {
      const requestWithoutOrigin = { get: () => undefined, method: 'POST' }
      const next = vi.fn()
      const originalNodeEnvironment = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      try {
        requireTrustedOrigin(requestWithoutOrigin, {}, next)
      } finally {
        process.env.NODE_ENV = originalNodeEnvironment
      }

      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        code: 'ORIGIN_NOT_ALLOWED',
        statusCode: 403,
      }))
    })
  })

  describe('POST /api/auth/login', () => {
    it('authenticates a valid password and returns only safe user fields', async () => {
      await request(app).post('/api/auth/register').send(validRegistration).expect(201)

      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'ANAS@EXAMPLE.COM', password: validRegistration.password })
        .expect(200)

      expect(response.body.user.email).toBe(validRegistration.email)
      expect(response.body.user).not.toHaveProperty('passwordHash')
      expect(response.headers['set-cookie'][0]).toContain('HttpOnly')
    })

    it.each([
      ['wrong password', { email: validRegistration.email, password: 'this password is incorrect' }],
      ['unknown email', { email: 'unknown@example.com', password: validRegistration.password }],
    ])('returns the same safe error for %s', async (_case, credentials) => {
      await request(app).post('/api/auth/register').send(validRegistration).expect(201)

      const response = await request(app).post('/api/auth/login').send(credentials).expect(401)

      expect(response.body).toEqual({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      })
    })
  })

  describe('session routes', () => {
    it('returns a console-safe empty result when no restorable session exists', async () => {
      const response = await request(app).get('/api/auth/session').expect(200)

      expect(response.body).toEqual({ success: true, user: null })
    })

    it('restores an authenticated session through GET /api/auth/session', async () => {
      const agent = request.agent(app)
      await agent.post('/api/auth/register').send(validRegistration).expect(201)

      const response = await agent.get('/api/auth/session').expect(200)

      expect(response.body.user).toMatchObject({
        email: validRegistration.email,
        name: validRegistration.name,
      })
      expect(response.body.user).not.toHaveProperty('passwordHash')
    })

    it('does not disguise an unexpected database failure as a signed-out session', async () => {
      const agent = request.agent(app)
      await agent.post('/api/auth/register').send(validRegistration).expect(201)
      vi.spyOn(User, 'findById').mockRejectedValueOnce(new Error('database unavailable'))
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const response = await agent.get('/api/auth/session').expect(500)

      expect(response.body).toEqual({
        success: false,
        code: 'INTERNAL_ERROR',
        message: 'An unexpected server error occurred.',
      })
    })

    it('rejects missing and invalid session cookies', async () => {
      const missing = await request(app).get('/api/auth/me').expect(401)
      const invalid = await request(app)
        .get('/api/auth/me')
        .set('Cookie', 'owntrace_session=not-a-valid-token')
        .expect(401)

      expect(missing.body.code).toBe('UNAUTHENTICATED')
      expect(invalid.body.code).toBe('INVALID_SESSION')
    })

    it('rejects an expired signed session token', async () => {
      const expiredToken = jwt.sign({}, getJwtSecret(), {
        algorithm: 'HS256',
        audience: TOKEN_AUDIENCE,
        expiresIn: -1,
        issuer: TOKEN_ISSUER,
        subject: '507f1f77bcf86cd799439011',
      })

      const response = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `owntrace_session=${expiredToken}`)
        .expect(401)

      expect(response.body.code).toBe('INVALID_SESSION')
    })

    it('clears the cookie and ends the browser session on logout', async () => {
      const agent = request.agent(app)
      const registration = await agent.post('/api/auth/register').send(validRegistration).expect(201)
      const originalCookie = registration.headers['set-cookie'][0].split(';')[0]

      const response = await agent.post('/api/auth/logout').expect(200)

      expect(response.headers['set-cookie'][0]).toContain('owntrace_session=;')
      expect(await Session.countDocuments()).toBe(0)
      await agent.get('/api/auth/me').expect(401)
      const replay = await request(app)
        .get('/api/auth/me')
        .set('Cookie', originalCookie)
        .expect(401)
      expect(replay.body.code).toBe('INVALID_SESSION')
    })
  })

  describe('DELETE /api/auth/account', () => {
    it('requires authentication and explicit confirmation', async () => {
      await request(app)
        .delete('/api/auth/account')
        .send({ confirmation: 'DELETE', password: validRegistration.password })
        .expect(401)

      const agent = request.agent(app)
      await agent.post('/api/auth/register').send(validRegistration).expect(201)
      const response = await agent
        .delete('/api/auth/account')
        .send({ password: validRegistration.password })
        .expect(400)

      expect(response.body).toMatchObject({
        code: 'VALIDATION_ERROR',
        errors: { confirmation: 'Type DELETE to confirm permanent account deletion.' },
      })
      expect(await User.countDocuments({ email: validRegistration.email })).toBe(1)
    })

    it('requires the current password and deletes all user-owned data', async () => {
      const agent = request.agent(app)
      const registration = await agent.post('/api/auth/register').send(validRegistration).expect(201)
      const userId = registration.body.user.id
      const now = new Date()
      const connection = await GoogleConnection.create({
        email: validRegistration.email,
        encryptedAccessToken: encryptSecret('delete-access-token'),
        encryptedRefreshToken: encryptSecret('delete-refresh-token'),
        googleAccountId: 'delete-google-account-id',
        scopes: [GMAIL_METADATA_SCOPE],
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        userId,
      })
      const signal = await GmailSignal.create({
        connectionId: connection.id,
        messageIdHash: 'delete-message-hash',
        occurredAt: now,
        senderDomain: 'example.com',
        senderEmail: 'account@example.com',
        subjectSignal: 'verify your account',
        threadIdHash: 'delete-thread-hash',
        userId,
      })
      const account = await Account.create({
        confidenceLevel: 'CONFIRMED',
        confidenceScore: 90,
        dormantReason: 'Recent account evidence exists.',
        dormantStatus: 'ACTIVE',
        evidenceClasses: ['ACCOUNT_VERIFICATION'],
        evidenceCount: 1,
        firstSeenAt: now,
        lastEvaluatedAt: now,
        lastOwnershipEvidenceAt: now,
        lastSeenAt: now,
        ownershipEvidenceCount: 1,
        primaryDomain: 'example.com',
        serviceKey: 'example.com',
        serviceName: 'Example',
        userId,
      })
      await Promise.all([
        AccountEvidence.create({
          accountId: account.id,
          connectionId: connection.id,
          evidenceClass: 'ACCOUNT_VERIFICATION',
          evidenceWeight: 90,
          gmailSignalId: signal.id,
          occurredAt: now,
          ownershipSignal: true,
          reasonCode: 'ACCOUNT_VERIFICATION',
          sourceDomain: 'example.com',
          userId,
        }),
        AccountAction.create({
          accountId: account.id,
          description: 'Review the account directly.',
          lastEvaluatedAt: now,
          priority: 'LOW',
          priorityRank: 1,
          reason: 'Routine account review.',
          title: 'Review this account',
          type: 'REVIEW_ACCOUNT',
          userId,
        }),
        GmailSyncJob.create({ connectionId: connection.id, status: 'COMPLETED', userId }),
        Subscription.create({
          basis: ['SUBSCRIPTION'],
          billingCycle: 'MONTHLY',
          confidenceLevel: 'POSSIBLE',
          confidenceScore: 50,
          evidenceCount: 1,
          firstSeenAt: now,
          lastSeenAt: now,
          primaryDomain: 'example.com',
          serviceKey: 'example.com',
          serviceName: 'Example',
          userId,
        }),
        MicrosoftConnection.create({
          email: 'microsoft-delete@example.com',
          encryptedAccessToken: encryptSecret('microsoft-delete-access-token'),
          encryptedRefreshToken: encryptSecret('microsoft-delete-refresh-token'),
          microsoftAccountId: 'delete-microsoft-account-id',
          scopes: ['Mail.ReadBasic'],
          tokenExpiresAt: new Date(Date.now() + 3_600_000),
          userId,
        }),
      ])
      const microsoftConnection = await MicrosoftConnection.findOne({ userId })
      await Promise.all([
        MicrosoftSignal.create({ connectionId: microsoftConnection.id, messageIdHash: 'microsoft-delete-message', occurredAt: now, threadIdHash: 'microsoft-delete-thread', userId }),
        MicrosoftSyncJob.create({ connectionId: microsoftConnection.id, status: 'COMPLETED', userId }),
        MicrosoftSubscription.create({ confidenceLevel: 'POSSIBLE', confidenceScore: 40, evidenceCount: 1, firstSeenAt: now, lastSeenAt: now, primaryDomain: 'microsoft-delete.example', serviceKey: 'microsoft-delete.example', serviceName: 'Microsoft Delete', userId }),
      ])

      await agent
        .delete('/api/auth/account')
        .send({ confirmation: 'DELETE', password: 'incorrect account deletion password' })
        .expect(401)
      expect(await User.countDocuments({ _id: userId })).toBe(1)

      const revokeToken = vi
        .spyOn(google.auth.OAuth2.prototype, 'revokeToken')
        .mockResolvedValue({ data: {} })
      const response = await agent
        .delete('/api/auth/account')
        .send({ confirmation: 'DELETE', password: validRegistration.password })
        .expect(200)

      expect(response.body).toEqual({
        success: true,
        deleted: true,
        providerRevocation: 'REVOKED',
      })
      expect(response.headers['set-cookie'][0]).toContain('owntrace_session=;')
      expect(revokeToken).toHaveBeenCalledWith('delete-refresh-token')
      expect(await Promise.all([
        User.countDocuments({ _id: userId }),
        GoogleConnection.countDocuments({ userId }),
        GmailSyncJob.countDocuments({ userId }),
        GmailSignal.countDocuments({ userId }),
        Account.countDocuments({ userId }),
        AccountEvidence.countDocuments({ userId }),
        AccountAction.countDocuments({ userId }),
        Subscription.countDocuments({ userId }),
        MicrosoftConnection.countDocuments({ userId }),
        MicrosoftSignal.countDocuments({ userId }),
        MicrosoftSyncJob.countDocuments({ userId }),
        MicrosoftSubscription.countDocuments({ userId }),
        Session.countDocuments({ userId }),
      ])).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
      await agent.get('/api/auth/me').expect(401)
    })

    it('still removes local data when Google revocation cannot be confirmed', async () => {
      const agent = request.agent(app)
      const registration = await agent.post('/api/auth/register').send(validRegistration).expect(201)
      const userId = registration.body.user.id
      await GoogleConnection.create({
        email: validRegistration.email,
        encryptedAccessToken: encryptSecret('failed-delete-access-token'),
        encryptedRefreshToken: encryptSecret('failed-delete-refresh-token'),
        googleAccountId: 'failed-delete-google-account-id',
        scopes: [GMAIL_METADATA_SCOPE],
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        userId,
      })
      vi.spyOn(google.auth.OAuth2.prototype, 'revokeToken').mockRejectedValue({
        response: { status: 503 },
      })

      const response = await agent
        .delete('/api/auth/account')
        .send({ confirmation: 'DELETE', password: validRegistration.password })
        .expect(200)

      expect(response.body.providerRevocation).toBe('FAILED')
      expect(await User.countDocuments({ _id: userId })).toBe(0)
      expect(await GoogleConnection.countDocuments({ userId })).toBe(0)
    })
  })

  describe('onboarding API', () => {
    it('requires an authenticated user', async () => {
      await request(app).get('/api/onboarding').expect(401)
      await request(app).patch('/api/onboarding').send({ status: 'PRIVACY_REVIEWED' }).expect(401)
    })

    it('persists the supported onboarding progression', async () => {
      const agent = request.agent(app)
      await agent.post('/api/auth/register').send(validRegistration).expect(201)

      const initial = await agent.get('/api/onboarding').expect(200)
      expect(initial.body.onboarding.status).toBe('NOT_STARTED')

      const privacy = await agent
        .patch('/api/onboarding')
        .send({ status: 'PRIVACY_REVIEWED' })
        .expect(200)
      expect(privacy.body.onboarding.status).toBe('PRIVACY_REVIEWED')

      const gmail = await agent
        .patch('/api/onboarding')
        .send({ status: 'GMAIL_PENDING' })
        .expect(200)
      expect(gmail.body.onboarding.status).toBe('GMAIL_PENDING')
      expect((await User.findOne({ email: validRegistration.email })).onboardingStatus).toBe(
        'GMAIL_PENDING',
      )
    })

    it('rejects unsupported or out-of-order states', async () => {
      const agent = request.agent(app)
      await agent.post('/api/auth/register').send(validRegistration).expect(201)

      const unsupported = await agent
        .patch('/api/onboarding')
        .send({ status: 'NOT_A_STATUS' })
        .expect(400)
      const outOfOrder = await agent
        .patch('/api/onboarding')
        .send({ status: 'GMAIL_PENDING' })
        .expect(409)

      expect(unsupported.body.code).toBe('INVALID_ONBOARDING_STATUS')
      expect(outOfOrder.body.code).toBe('ONBOARDING_STEP_OUT_OF_ORDER')
      await agent.patch('/api/onboarding').send({ status: 'COMPLETED' }).expect(409)
    })

    it('lets a user finish reviewed setup without connecting a provider', async () => {
      const agent = request.agent(app)
      await agent.post('/api/auth/register').send(validRegistration).expect(201)
      await agent.patch('/api/onboarding').send({ status: 'PRIVACY_REVIEWED' }).expect(200)
      await agent.patch('/api/onboarding').send({ status: 'GMAIL_PENDING' }).expect(200)
      await agent.patch('/api/onboarding').send({ status: 'COMPLETED' }).expect(200)
      const { body } = await agent.get('/api/auth/session').expect(200)
      expect(body.user.onboardingStatus).toBe('COMPLETED')
      expect(await GoogleConnection.countDocuments()).toBe(0)
      expect(await MicrosoftConnection.countDocuments()).toBe(0)
    })
  })

  describe('Google connection API', () => {
    it('encrypts and authenticates provider secrets at rest', () => {
      const encrypted = encryptSecret('provider-token-value')

      expect(encrypted).not.toContain('provider-token-value')
      expect(decryptSecret(encrypted)).toBe('provider-token-value')
      const tamperedParts = encrypted.split('.')
      const replacement = tamperedParts[3].startsWith('A') ? 'B' : 'A'
      tamperedParts[3] = `${replacement}${tamperedParts[3].slice(1)}`
      expect(() => decryptSecret(tamperedParts.join('.'))).toThrow()
    })

    it('returns a safe unconnected status for the authenticated user', async () => {
      const agent = request.agent(app)
      await agent.post('/api/auth/register').send(validRegistration).expect(201)

      const response = await agent.get('/api/google/connection').expect(200)

      expect(response.body.google).toMatchObject({
        available: true,
        capabilities: {
          confirmed: [
            { active: false, id: 'verified-google-identity' },
            { active: false, id: 'oauth-connection-state' },
            { active: false, id: 'gmail-metadata-access' },
          ],
          inferred: [{ active: false, id: 'account-relationships' }],
          unsupported: [{ active: false, id: 'google-connected-apps-inventory' }],
        },
        connection: null,
        syncPolicy: { batchSize: 25, messageLimit: 2_000 },
      })
      await request(app).get('/api/google/connection').expect(401)
    })

    it('creates a signed, session-bound authorization request with minimum scopes', async () => {
      const agent = request.agent(app)
      await agent.post('/api/auth/register').send(validRegistration).expect(201)

      const response = await agent.get('/api/google/oauth/start').expect(302)
      const authorizationUrl = new URL(response.headers.location)

      expect(authorizationUrl.origin).toBe('https://accounts.google.com')
      expect(authorizationUrl.searchParams.get('access_type')).toBe('offline')
      expect(authorizationUrl.searchParams.get('prompt')).toBe('consent')
      expect(authorizationUrl.searchParams.has('include_granted_scopes')).toBe(false)
      expect(authorizationUrl.searchParams.get('scope').split(' ').sort()).toEqual(
        ['openid', 'email', GMAIL_METADATA_SCOPE].sort(),
      )
      expect(authorizationUrl.searchParams.get('state')).not.toContain('.')
      expect(response.headers['set-cookie'].join(';')).toContain('owntrace_google_oauth=')
      expect(response.headers['set-cookie'].join(';')).toContain('HttpOnly')
      expect(response.headers['set-cookie'].join(';')).toContain('SameSite=Lax')
    })

    it('rejects a callback whose state does not match the signed cookie', async () => {
      const agent = request.agent(app)
      await agent.post('/api/auth/register').send(validRegistration).expect(201)
      await agent.get('/api/google/oauth/start').expect(302)

      const response = await agent
        .get('/api/google/oauth/callback?code=test-code&state=wrong-state')
        .expect(302)

      expect(response.headers.location).toBe(
        'http://localhost:5173/connect/gmail?google=invalid_oauth_state',
      )
      expect(await GoogleConnection.countDocuments()).toBe(0)
    })

    it('stores encrypted tokens after verified consent and revokes them on disconnect', async () => {
      const agent = request.agent(app)
      await agent.post('/api/auth/register').send(validRegistration).expect(201)
      const startResponse = await agent.get('/api/google/oauth/start').expect(302)
      const state = new URL(startResponse.headers.location).searchParams.get('state')

      vi.spyOn(google.auth.OAuth2.prototype, 'getToken').mockResolvedValue({
        tokens: {
          access_token: 'google-access-token',
          expiry_date: Date.now() + 3_600_000,
          id_token: 'signed-google-id-token',
          refresh_token: 'google-refresh-token',
          scope: `openid email ${GMAIL_METADATA_SCOPE}`,
        },
      })
      vi.spyOn(google.auth.OAuth2.prototype, 'verifyIdToken').mockResolvedValue({
        getPayload: () => ({
          email: 'google-user@example.com',
          email_verified: true,
          sub: 'stable-google-account-id',
        }),
      })
      const revokeToken = vi
        .spyOn(google.auth.OAuth2.prototype, 'revokeToken')
        .mockResolvedValue({ data: {} })

      const callback = await agent
        .get(`/api/google/oauth/callback?code=test-code&state=${encodeURIComponent(state)}`)
        .expect(302)
      expect(callback.headers.location).toBe(
        'http://localhost:5173/connect/gmail?google=connected',
      )

      const storedConnection = await GoogleConnection.findOne({})
        .select('+encryptedAccessToken +encryptedRefreshToken')
      expect(storedConnection.encryptedAccessToken).not.toContain('google-access-token')
      expect(decryptSecret(storedConnection.encryptedAccessToken)).toBe('google-access-token')
      expect(decryptSecret(storedConnection.encryptedRefreshToken)).toBe('google-refresh-token')

      const status = await agent.get('/api/google/connection').expect(200)
      expect(JSON.stringify(status.body)).not.toContain('google-access-token')
      expect(JSON.stringify(status.body)).not.toContain('google-refresh-token')
      expect(status.body.google.connection).not.toHaveProperty('encryptedAccessToken')
      expect(status.body.google.connection).not.toHaveProperty('encryptedRefreshToken')
      expect(status.body.google.connection).toMatchObject({
        email: 'google-user@example.com',
        status: 'CONNECTED',
      })
      expect(status.body.google.capabilities).toMatchObject({
        confirmed: [
          { active: true, id: 'verified-google-identity' },
          { active: true, id: 'oauth-connection-state' },
          { active: true, id: 'gmail-metadata-access' },
        ],
        inferred: [{ active: true, id: 'account-relationships' }],
        unsupported: [{ active: false, id: 'google-connected-apps-inventory' }],
      })

      await Subscription.create({
        basis: ['PAYMENT'],
        billingCycle: 'MONTHLY',
        confidenceLevel: 'POSSIBLE',
        confidenceScore: 55,
        evidenceCount: 1,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        primaryDomain: 'disconnect.example',
        serviceKey: 'disconnect.example',
        serviceName: 'Disconnect Example',
        userId: storedConnection.userId,
      })

      await agent.delete('/api/google/connection').expect(200)
      expect(revokeToken).toHaveBeenCalledWith('google-refresh-token')
      expect(await GoogleConnection.countDocuments()).toBe(0)
      expect(await Subscription.countDocuments()).toBe(0)
      expect((await User.findOne({ email: validRegistration.email })).authProviders).toEqual([
        'password',
      ])
    })

    it('handles a denied provider consent without creating a connection', async () => {
      const agent = request.agent(app)
      await agent.post('/api/auth/register').send(validRegistration).expect(201)

      const response = await agent
        .get('/api/google/oauth/callback?error=access_denied')
        .expect(302)

      expect(response.headers.location).toBe('http://localhost:5173/connect/gmail?google=denied')
      expect(await GoogleConnection.countDocuments()).toBe(0)
    })

    it('stores only minimized metadata signals and keeps repeated scans idempotent', async () => {
      const agent = request.agent(app)
      await agent.post('/api/auth/register').send(validRegistration).expect(201)
      const user = await User.findOne({ email: validRegistration.email })
      await GoogleConnection.create({
        email: 'google-user@example.com',
        encryptedAccessToken: encryptSecret('access-token'),
        encryptedRefreshToken: encryptSecret('refresh-token'),
        googleAccountId: 'stable-google-account-id',
        scopes: [GMAIL_METADATA_SCOPE],
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        userId: user.id,
      })

      const list = vi.fn().mockResolvedValue({
        data: {
          messages: [{ id: 'provider-message-1' }, { id: 'provider-message-2' }],
          resultSizeEstimate: 2,
        },
      })
      const get = vi.fn(({ id }) => Promise.resolve({
        data: {
          id,
          internalDate: String(Date.now()),
          payload: {
            headers: [
              { name: 'From', value: 'Canva <account@canva.com>' },
              { name: 'Subject', value: 'Verify anas@example.com with code 123456' },
            ],
          },
          threadId: `thread-${id}`,
        },
      }))
      vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { get, list } } })

      await agent.post('/api/google/sync').expect(202)
      const firstScan = await agent.post('/api/google/sync/next').expect(200)

      expect(firstScan.body.sync).toMatchObject({
        processedCount: 2,
        status: 'COMPLETED',
        storedCount: 2,
      })
      const signals = await GmailSignal.find({ userId: user.id }).lean()
      expect(signals).toHaveLength(2)
      expect(signals[0]).toMatchObject({
        senderDomain: 'canva.com',
        senderEmail: 'account@canva.com',
        subjectSignal: 'verify [email] with code [number]',
      })
      expect(JSON.stringify(signals)).not.toContain('provider-message-1')
      expect(JSON.stringify(signals)).not.toContain('123456')
      expect(await Account.countDocuments({ userId: user.id })).toBe(1)
      expect(await AccountEvidence.countDocuments({ userId: user.id })).toBe(2)
      expect(await AccountAction.countDocuments({ userId: user.id })).toBe(1)
      expect((await User.findById(user.id)).onboardingStatus).toBe('COMPLETED')

      await agent.post('/api/google/sync').expect(202)
      const repeatedScan = await agent.post('/api/google/sync/next').expect(200)
      expect(repeatedScan.body.sync.storedCount).toBe(0)
      expect(await GmailSignal.countDocuments({ userId: user.id })).toBe(2)
      expect(await AccountAction.countDocuments({ userId: user.id })).toBe(1)
    })

    it('returns safe rate-limit state and preserves sync progress', async () => {
      const agent = request.agent(app)
      await agent.post('/api/auth/register').send(validRegistration).expect(201)
      const user = await User.findOne({ email: validRegistration.email })
      await GoogleConnection.create({
        email: 'google-user@example.com',
        encryptedAccessToken: encryptSecret('access-token'),
        encryptedRefreshToken: encryptSecret('refresh-token'),
        googleAccountId: 'stable-google-account-id',
        scopes: [GMAIL_METADATA_SCOPE],
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        userId: user.id,
      })
      vi.spyOn(google, 'gmail').mockReturnValue({
        users: {
          messages: {
            list: vi.fn().mockRejectedValue({ response: { status: 429 } }),
          },
        },
      })

      await agent.post('/api/google/sync').expect(202)
      const response = await agent.post('/api/google/sync/next').expect(429)

      expect(response.body.code).toBe('GOOGLE_RATE_LIMITED')
      expect((await GmailSyncJob.findOne({ userId: user.id })).status).toBe('FAILED')
      expect((await GoogleConnection.findOne({ userId: user.id })).lastErrorCode).toBe(
        'GOOGLE_RATE_LIMITED',
      )
    })

    it('prevents concurrent requests from resetting or duplicating Gmail sync progress', async () => {
      const agent = request.agent(app)
      await agent.post('/api/auth/register').send(validRegistration).expect(201)
      const user = await User.findOne({ email: validRegistration.email })
      await GoogleConnection.create({
        email: 'google-user@example.com',
        encryptedAccessToken: encryptSecret('access-token'),
        encryptedRefreshToken: encryptSecret('refresh-token'),
        googleAccountId: 'stable-google-account-id',
        scopes: [GMAIL_METADATA_SCOPE],
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        userId: user.id,
      })

      let releaseList
      let markListStarted
      const listStarted = new Promise((resolve) => { markListStarted = resolve })
      const listReleased = new Promise((resolve) => { releaseList = resolve })
      const list = vi.fn(async () => {
        markListStarted()
        await listReleased
        return { data: { messages: [], resultSizeEstimate: 0 } }
      })
      vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { list } } })

      await agent.post('/api/google/sync').expect(202)
      await agent.post('/api/google/sync').expect(409, {
        success: false,
        code: 'GMAIL_SYNC_IN_PROGRESS',
        message: 'A Gmail metadata scan is already in progress.',
      })

      const firstBatch = agent.post('/api/google/sync/next').then((response) => response)
      await listStarted
      const overlappingBatch = await agent.post('/api/google/sync/next').expect(409)
      expect(overlappingBatch.body.code).toBe('GMAIL_SYNC_IN_PROGRESS')

      releaseList()
      expect((await firstBatch).status).toBe(200)
      expect((await GmailSyncJob.findOne({ userId: user.id })).status).toBe('COMPLETED')
      expect(list).toHaveBeenCalledTimes(1)
    })

    it('recovers a stale Gmail batch lock after an interrupted worker', async () => {
      const agent = request.agent(app)
      await agent.post('/api/auth/register').send(validRegistration).expect(201)
      const user = await User.findOne({ email: validRegistration.email })
      const connection = await GoogleConnection.create({
        email: 'google-user@example.com',
        encryptedAccessToken: encryptSecret('access-token'),
        encryptedRefreshToken: encryptSecret('refresh-token'),
        googleAccountId: 'stable-google-account-id',
        scopes: [GMAIL_METADATA_SCOPE],
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        userId: user.id,
      })
      const job = await GmailSyncJob.create({
        connectionId: connection.id,
        status: 'SCANNING',
        userId: user.id,
      })
      await GmailSyncJob.collection.updateOne(
        { _id: job._id },
        { $set: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) } },
      )
      vi.spyOn(google, 'gmail').mockReturnValue({
        users: { messages: { list: vi.fn().mockResolvedValue({ data: { messages: [] } }) } },
      })

      const response = await agent.post('/api/google/sync/next').expect(200)

      expect(response.body.sync.status).toBe('COMPLETED')
      expect((await GmailSyncJob.findById(job.id)).status).toBe('COMPLETED')
    })

    it('keeps Gmail sync state scoped to the authenticated user', async () => {
      const firstAgent = request.agent(app)
      const secondAgent = request.agent(app)
      await firstAgent.post('/api/auth/register').send(validRegistration).expect(201)
      await secondAgent.post('/api/auth/register').send({
        ...validRegistration,
        email: 'second@example.com',
      }).expect(201)
      const firstUser = await User.findOne({ email: validRegistration.email })
      await GoogleConnection.create({
        email: 'google-user@example.com',
        encryptedAccessToken: encryptSecret('access-token'),
        encryptedRefreshToken: encryptSecret('refresh-token'),
        googleAccountId: 'stable-google-account-id',
        scopes: [GMAIL_METADATA_SCOPE],
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        userId: firstUser.id,
      })

      await firstAgent.post('/api/google/sync').expect(202)
      const secondUserView = await secondAgent.get('/api/google/sync').expect(200)

      expect(secondUserView.body.sync).toBeNull()

      const secondUserConnection = await secondAgent.get('/api/google/connection').expect(200)
      expect(secondUserConnection.body.google.connection).toBeNull()

      const secondUserDisconnect = await secondAgent.delete('/api/google/connection').expect(200)
      expect(secondUserDisconnect.body.disconnected).toBe(false)
      expect(await GoogleConnection.countDocuments({ userId: firstUser.id })).toBe(1)
    })
  })
})
