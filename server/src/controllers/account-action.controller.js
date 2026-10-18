import {
  getAccountActionSummary as getSummaryForUser,
  listAccountActions as listActionsForUser,
  updateAccountActionStatus as updateStatusForUser,
} from '../services/account-action.service.js'

async function listAccountActions(request, response) {
  const result = await listActionsForUser(request.auth.userId, request.query)
  response.status(200).json({ success: true, ...result })
}

async function getAccountActionSummary(request, response) {
  const summary = await getSummaryForUser(request.auth.userId)
  response.status(200).json({ success: true, summary })
}

async function updateAccountActionStatus(request, response) {
  const action = await updateStatusForUser(
    request.auth.userId,
    request.params.id,
    request.body?.status,
  )
  response.status(200).json({ success: true, action: action.toJSON() })
}

export { getAccountActionSummary, listAccountActions, updateAccountActionStatus }
