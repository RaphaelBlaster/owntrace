import mongoose from 'mongoose'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import app from '../src/app.js'
import AccountEvidence from '../src/models/account-evidence.model.js'
import Account from '../src/models/account.model.js'
import GoogleConnection from '../src/models/google-connection.model.js'
import MicrosoftConnection from '../src/models/microsoft-connection.model.js'
import User from '../src/models/user.model.js'

async function registerUser(email, name = 'Identity Test User') {
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/register').send({
    email,
    name,
    password: 'a secure identity test password',
  }).expect(201)
  return { agent, userId: response.body.user.id }
}

async function createAccount(userId, serviceKey) {
  const now = new Date()
  return Account.create({
    confidenceLevel: 'CONFIRMED',
    confidenceScore: 93,
    dormantReason: 'Account-related evidence was detected within the last 12 months.',
    dormantStatus: 'ACTIVE',
    evidenceClasses: ['ACCOUNT_VERIFICATION'],
    evidenceCount: 1,
    firstSeenAt: now,
    lastEvaluatedAt: now,
    lastOwnershipEvidenceAt: now,
    lastSeenAt: now,
    ownershipEvidenceCount: 1,
    primaryDomain: serviceKey,
    serviceKey,
    serviceName: serviceKey === 'github.com' ? 'GitHub' : 'Other',
    userId,
  })
}

beforeAll(async () => {
  await Promise.all([User.init(), Account.init(), AccountEvidence.init(), GoogleConnection.init()])
})

describe('identity graph API', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/identity').expect(401)
  })

  it('derives safe user-scoped nodes and deterministic relationships', async () => {
    const owner = await registerUser('identity-owner@example.com', 'Identity Owner')
    const other = await registerUser('identity-other@example.com')
    const [account, otherAccount] = await Promise.all([
      createAccount(owner.userId, 'github.com'),
      createAccount(other.userId, 'private.example'),
    ])
    const connection = await GoogleConnection.create({
      email: 'connected@example.com',
      encryptedAccessToken: 'v1.encrypted.access',
      encryptedRefreshToken: 'v1.encrypted.refresh',
      googleAccountId: 'provider-account-id-must-remain-private',
      scopes: ['https://www.googleapis.com/auth/gmail.metadata'],
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      userId: owner.userId,
    })

    await Promise.all([
      AccountEvidence.create({
        accountId: account.id,
        connectionId: connection.id,
        evidenceClass: 'ACCOUNT_VERIFICATION',
        evidenceWeight: 86,
        gmailSignalId: new mongoose.Types.ObjectId(),
        occurredAt: new Date(),
        ownershipSignal: true,
        reasonCode: 'ACCOUNT_VERIFICATION_LANGUAGE',
        sourceDomain: 'github.com',
        userId: owner.userId,
      }),
      AccountEvidence.create({
        accountId: otherAccount.id,
        connectionId: new mongoose.Types.ObjectId(),
        evidenceClass: 'LOGIN_ALERT',
        evidenceWeight: 76,
        gmailSignalId: new mongoose.Types.ObjectId(),
        occurredAt: new Date(),
        ownershipSignal: true,
        reasonCode: 'LOGIN_ACTIVITY_LANGUAGE',
        sourceDomain: 'private.example',
        userId: other.userId,
      }),
    ])

    const response = await owner.agent.get('/api/identity').expect(200)
    const { graph } = response.body
    const serialized = JSON.stringify(graph)

    expect(graph.summary).toEqual({
      accountCount: 1,
      connectedIdentityCount: 1,
      emailIdentityCount: 1,
      renderedAccountCount: 1,
      serviceCount: 1,
      truncated: false,
    })
    expect(graph.nodes.map((node) => node.type).sort()).toEqual([
      'ACCOUNT',
      'EMAIL_IDENTITY',
      'GOOGLE_IDENTITY',
      'PROFILE',
      'SERVICE',
    ])
    expect(graph.nodes.find((node) => node.type === 'ACCOUNT')).toMatchObject({
      label: 'GitHub',
      resourceId: account.id,
    })
    expect(graph.edges.map((edge) => edge.type).sort()).toEqual([
      'AUTHENTICATES_AS',
      'BELONGS_TO_SERVICE',
      'CONNECTED_IDENTITY',
      'DISCOVERED_ACCOUNT',
    ])
    expect(serialized).not.toContain('private.example')
    expect(serialized).not.toContain('provider-account-id-must-remain-private')
    expect(serialized).not.toContain('v1.encrypted')
    expect(serialized).not.toContain('gmailSignalId')
    expect(serialized).not.toContain('connectionId')
  })

  it('keeps an account connected to the profile when no provider identity remains', async () => {
    const owner = await registerUser('identity-local@example.com', 'Local Owner')
    const account = await createAccount(owner.userId, 'github.com')

    const response = await owner.agent.get('/api/identity').expect(200)
    expect(response.body.graph.nodes.some((node) => node.type === 'GOOGLE_IDENTITY')).toBe(false)
    expect(response.body.graph.edges).toContainEqual(expect.objectContaining({
      source: 'profile',
      target: `account:${account.id}`,
      type: 'HAS_ACCOUNT_EVIDENCE',
    }))
  })

  it('shows both connected provider identities without exposing provider credentials', async () => {
    const owner = await registerUser('identity-dual@example.com', 'Dual Identity Owner')
    await Promise.all([
      GoogleConnection.create({
        email: 'identity-dual@gmail.example',
        encryptedAccessToken: 'v1.google.private.access',
        encryptedRefreshToken: 'v1.google.private.refresh',
        googleAccountId: 'private-google-account-id',
        scopes: ['https://www.googleapis.com/auth/gmail.metadata'],
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        userId: owner.userId,
      }),
      MicrosoftConnection.create({
        email: 'identity-dual@outlook.example',
        encryptedAccessToken: 'v1.microsoft.private.access',
        encryptedRefreshToken: 'v1.microsoft.private.refresh',
        microsoftAccountId: 'private-microsoft-account-id',
        scopes: ['Mail.ReadBasic'],
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        userId: owner.userId,
      }),
    ])

    const response = await owner.agent.get('/api/identity').expect(200)
    const serialized = JSON.stringify(response.body)
    expect(response.body.graph.summary.connectedIdentityCount).toBe(2)
    expect(response.body.graph.nodes.map((node) => node.type)).toEqual(expect.arrayContaining([
      'GOOGLE_IDENTITY',
      'MICROSOFT_IDENTITY',
    ]))
    expect(serialized).not.toContain('private-google-account-id')
    expect(serialized).not.toContain('private-microsoft-account-id')
    expect(serialized).not.toContain('v1.google.private')
    expect(serialized).not.toContain('v1.microsoft.private')
  })

  it('reports full counts while bounding the visual graph to 200 accounts', async () => {
    const owner = await registerUser('identity-scale@example.com', 'Scale Owner')
    const now = new Date()

    await Account.insertMany(Array.from({ length: 201 }, (_, index) => ({
      confidenceLevel: 'LIKELY',
      confidenceScore: 70 + (index % 20),
      dormantReason: 'Account-related evidence was detected within the last 12 months.',
      dormantStatus: 'ACTIVE',
      evidenceClasses: ['WELCOME'],
      evidenceCount: 1,
      firstSeenAt: now,
      lastEvaluatedAt: now,
      lastOwnershipEvidenceAt: now,
      lastSeenAt: now,
      ownershipEvidenceCount: 1,
      primaryDomain: `service-${index}.example`,
      serviceKey: `service-${index}.example`,
      serviceName: `Service ${index}`,
      userId: owner.userId,
    })))

    const response = await owner.agent.get('/api/identity').expect(200)
    expect(response.body.graph.summary).toMatchObject({
      accountCount: 201,
      renderedAccountCount: 200,
      serviceCount: 201,
      truncated: true,
    })
    expect(response.body.graph.nodes.filter((node) => node.type === 'ACCOUNT')).toHaveLength(200)
    expect(response.body.graph.nodes.filter((node) => node.type === 'SERVICE')).toHaveLength(200)
  })
})
