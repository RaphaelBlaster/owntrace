import { initialAccounts, initialActions } from './data.js'

const storageKey = 'owntrace.prism.workspace.v1'
export const defaultProfile = { name: 'Alex Morgan', goal: 'Get organized', digest: true, reminders: true }
const goals = ['Get organized', 'Reduce recurring costs', 'Improve account security']
const decisions = ['Protection reviewed', 'Keep this plan', 'Revisit this plan', 'Keep this account', 'Archive after exporting']

export function restoreWorkspace(raw) {
  let saved
  try { saved = JSON.parse(raw) } catch { saved = null }
  if (!saved || saved.version !== 1) saved = {}
  const previousActions = Array.isArray(saved.actions) ? saved.actions : []
  const previousAccounts = Array.isArray(saved.accounts) ? saved.accounts : []
  const actions = initialActions.map(action => {
    const previous = previousActions.find(item => item?.id === action.id)
    return { ...action, state: previous?.state === 'Done' ? 'Done' : 'To do', decision: decisions.includes(previous?.decision) ? previous.decision : undefined }
  })
  const accounts = initialAccounts.map(account => ({ ...account, reviewed: previousAccounts.find(item => item?.id === account.id)?.reviewed === true }))
  const manual = previousAccounts.filter(account => typeof account?.id === 'string' && account.id.startsWith('sample-') && typeof account.name === 'string' && account.name.trim() && Number.isFinite(account.cost) && account.cost > 0 && account.cost <= 10000).slice(0, 100)
  for (const account of manual) if (!accounts.some(item => item.id === account.id)) accounts.push({ id: account.id, name: account.name.trim().slice(0, 40), cost: account.cost, domain: 'manually-added.example.test', category: ['Productivity', 'Creative', 'Entertainment', 'Storage', 'Other'].includes(account.category) ? account.category : 'Other', color: '#167d99', status: 'Active', confidence: 'Unknown', lastSeen: 'Manually added', source: 'Manual entry', signals: 0, plan: 'Manual plan', renewal: 'Not specified', risk: 'Low', joined: 'Manual entry', evidence: ['Manually entered sample'], reviewed: account.reviewed === true })
  const checks = Object.fromEntries(initialActions.map(action => [action.id, Array.isArray(saved.checks?.[action.id]) ? [...new Set(saved.checks[action.id].filter(index => Number.isInteger(index) && index >= 0 && index < action.steps.length))] : []]))
  const profile = { ...defaultProfile, name: typeof saved.profile?.name === 'string' && saved.profile.name.trim() ? saved.profile.name.trim().slice(0, 40) : defaultProfile.name, goal: goals.includes(saved.profile?.goal) ? saved.profile.goal : defaultProfile.goal, digest: saved.profile?.digest !== false, reminders: saved.profile?.reminders !== false }
  return { actions, accounts, checks, profile, providers: { Gmail: saved.providers?.Gmail !== false, Outlook: saved.providers?.Outlook !== false }, lastScan: typeof saved.lastScan === 'string' ? saved.lastScan.slice(0, 50) : 'Today, 9:42 AM' }
}

export function loadWorkspace() {
  try { return restoreWorkspace(sessionStorage.getItem(storageKey)) } catch { return restoreWorkspace(null) }
}

export function saveWorkspace(value) {
  try { sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, ...value })) } catch { /* The prototype also works when browser storage is disabled. */ }
}
