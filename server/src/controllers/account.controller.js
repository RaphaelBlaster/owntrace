import {
  getAccount as getAccountForUser,
  getAccountSummary as getSummaryForUser,
  listAccounts as listAccountsForUser,
} from '../services/account.service.js'

async function listAccounts(request, response) {
  const result = await listAccountsForUser(request.auth.userId, request.query)
  response.status(200).json({ success: true, ...result })
}

async function getAccount(request, response) {
  const result = await getAccountForUser(request.auth.userId, request.params.id)
  response.status(200).json({ success: true, ...result })
}

async function getAccountSummary(request, response) {
  const summary = await getSummaryForUser(request.auth.userId)
  response.status(200).json({ success: true, summary })
}

export { getAccount, getAccountSummary, listAccounts }
