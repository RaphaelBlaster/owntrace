const ACTIVE_MONTHS = 12
const DORMANT_MONTHS = 24

function subtractUtcMonths(value, months) {
  const result = new Date(value)
  result.setUTCMonth(result.getUTCMonth() - months)
  return result
}

function evaluateDormancy({ lastOwnershipEvidenceAt, ownershipEvidenceCount }, now = new Date()) {
  if (!ownershipEvidenceCount || !lastOwnershipEvidenceAt) {
    return {
      dormantReason: 'No ownership evidence is available, so dormancy cannot be inferred.',
      dormantStatus: 'UNKNOWN',
    }
  }

  const lastActivity = new Date(lastOwnershipEvidenceAt)
  const activeThreshold = subtractUtcMonths(now, ACTIVE_MONTHS)
  const dormantThreshold = subtractUtcMonths(now, DORMANT_MONTHS)

  if (lastActivity >= activeThreshold) {
    return {
      dormantReason: 'Account-related evidence was detected within the last 12 months.',
      dormantStatus: 'ACTIVE',
    }
  }

  if (lastActivity >= dormantThreshold) {
    return {
      dormantReason: 'No account-related evidence was detected in the last 12 months.',
      dormantStatus: 'POSSIBLY_DORMANT',
    }
  }

  return {
    dormantReason: 'No account-related evidence was detected in the last 24 months.',
    dormantStatus: 'DORMANT',
  }
}

async function refreshDormancyForUser(Account, userId, now = new Date()) {
  const activeThreshold = subtractUtcMonths(now, ACTIVE_MONTHS)
  const dormantThreshold = subtractUtcMonths(now, DORMANT_MONTHS)
  const missingOwnershipEvidence = {
    $or: [
      { $lte: ['$ownershipEvidenceCount', 0] },
      { $eq: [{ $ifNull: ['$lastOwnershipEvidenceAt', null] }, null] },
    ],
  }

  await Account.updateMany(
    { userId },
    [{
      $set: {
        dormantReason: {
          $switch: {
            branches: [
              {
                case: missingOwnershipEvidence,
                then: 'No ownership evidence is available, so dormancy cannot be inferred.',
              },
              {
                case: { $gte: ['$lastOwnershipEvidenceAt', activeThreshold] },
                then: 'Account-related evidence was detected within the last 12 months.',
              },
              {
                case: { $gte: ['$lastOwnershipEvidenceAt', dormantThreshold] },
                then: 'No account-related evidence was detected in the last 12 months.',
              },
            ],
            default: 'No account-related evidence was detected in the last 24 months.',
          },
        },
        dormantStatus: {
          $switch: {
            branches: [
              { case: missingOwnershipEvidence, then: 'UNKNOWN' },
              { case: { $gte: ['$lastOwnershipEvidenceAt', activeThreshold] }, then: 'ACTIVE' },
              {
                case: { $gte: ['$lastOwnershipEvidenceAt', dormantThreshold] },
                then: 'POSSIBLY_DORMANT',
              },
            ],
            default: 'DORMANT',
          },
        },
      },
    }],
    { timestamps: false, updatePipeline: true },
  )
}

export { evaluateDormancy, refreshDormancyForUser }
