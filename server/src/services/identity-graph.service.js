import AccountEvidence from '../models/account-evidence.model.js'
import Account from '../models/account.model.js'
import GoogleConnection from '../models/google-connection.model.js'
import MicrosoftConnection from '../models/microsoft-connection.model.js'
import User from '../models/user.model.js'
import AppError from '../utils/app-error.js'

const GRAPH_ACCOUNT_LIMIT = 200

function addEdge(edges, source, target, type, label) {
  edges.push({ id: `${source}:${type}:${target}`, label, source, target, type })
}

async function getIdentityGraph(userId) {
  const [user, googleConnection, microsoftConnection, accounts, accountCount] = await Promise.all([
    User.findById(userId).select('email name').lean(),
    GoogleConnection.findOne({ userId }).select('email status').lean(),
    MicrosoftConnection.findOne({ userId }).select('email status').lean(),
    Account.find({ userId })
      .sort({ confidenceScore: -1, serviceName: 1 })
      .limit(GRAPH_ACCOUNT_LIMIT)
      .lean(),
    Account.countDocuments({ userId }),
  ])

  if (!user) throw new AppError('Identity graph not found.', 404, 'IDENTITY_GRAPH_NOT_FOUND')

  const nodes = [
    {
      detail: 'OwnTrace profile',
      id: 'profile',
      label: user.name,
      status: 'CONFIRMED',
      type: 'PROFILE',
    },
    {
      detail: 'OwnTrace sign-in email',
      id: 'email:primary',
      label: user.email,
      status: 'CONFIRMED',
      type: 'EMAIL_IDENTITY',
    },
  ]
  const edges = []
  addEdge(edges, 'profile', 'email:primary', 'AUTHENTICATES_AS', 'Authenticates as')

  if (googleConnection) {
    nodes.push({
      detail: 'Connected Google identity',
      id: 'google',
      label: googleConnection.email,
      status: googleConnection.status,
      type: 'GOOGLE_IDENTITY',
    })
    addEdge(edges, 'profile', 'google', 'CONNECTED_IDENTITY', 'Connected identity')
  }

  if (microsoftConnection) {
    nodes.push({
      detail: 'Connected Microsoft identity',
      id: 'microsoft',
      label: microsoftConnection.email,
      status: microsoftConnection.status,
      type: 'MICROSOFT_IDENTITY',
    })
    addEdge(edges, 'profile', 'microsoft', 'CONNECTED_IDENTITY', 'Connected identity')
  }

  const providerAccountIds = await Promise.all([
    googleConnection ? AccountEvidence.distinct('accountId', {
      accountId: { $in: accounts.map((account) => account._id) },
      connectionId: googleConnection._id,
      userId,
    }) : [],
    microsoftConnection ? AccountEvidence.distinct('accountId', {
      accountId: { $in: accounts.map((account) => account._id) },
      connectionId: microsoftConnection._id,
      userId,
    }) : [],
  ])
  const connectedAccountIds = new Set(providerAccountIds.flat().map((accountId) => accountId.toString()))
  const googleAccountIds = new Set((providerAccountIds[0] || []).map((accountId) => accountId.toString()))
  const microsoftAccountIds = new Set((providerAccountIds[1] || []).map((accountId) => accountId.toString()))

  accounts.forEach((account) => {
    const accountNodeId = `account:${account._id}`
    const serviceNodeId = `service:${account._id}`
    nodes.push(
      {
        confidenceLevel: account.confidenceLevel,
        detail: `${account.confidenceLevel.toLowerCase()} confidence`,
        id: accountNodeId,
        label: account.serviceName,
        resourceId: account._id.toString(),
        status: account.confidenceLevel,
        type: 'ACCOUNT',
      },
      {
        detail: 'Service domain',
        id: serviceNodeId,
        label: account.primaryDomain,
        status: 'CONFIRMED',
        type: 'SERVICE',
      },
    )

    if (googleAccountIds.has(account._id.toString())) addEdge(edges, 'google', accountNodeId, 'DISCOVERED_ACCOUNT', 'Discovered account')
    if (microsoftAccountIds.has(account._id.toString())) addEdge(edges, 'microsoft', accountNodeId, 'DISCOVERED_ACCOUNT', 'Discovered account')
    if (!connectedAccountIds.has(account._id.toString())) {
      addEdge(edges, 'profile', accountNodeId, 'HAS_ACCOUNT_EVIDENCE', 'Has account evidence')
    }
    addEdge(edges, accountNodeId, serviceNodeId, 'BELONGS_TO_SERVICE', 'Belongs to service')
  })

  return {
    edges,
    generatedAt: new Date().toISOString(),
    nodes,
    summary: {
      accountCount,
      connectedIdentityCount: Number(Boolean(googleConnection)) + Number(Boolean(microsoftConnection)),
      emailIdentityCount: 1,
      renderedAccountCount: accounts.length,
      serviceCount: accountCount,
      truncated: accountCount > accounts.length,
    },
  }
}

export { getIdentityGraph }
