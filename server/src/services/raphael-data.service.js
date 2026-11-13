import PrivacyRequest from '../models/privacy-request.model.js'
import BreachReport from '../models/breach-report.model.js'
import Subscription from '../models/subscription.model.js'
import MicrosoftSubscription from '../models/microsoft-subscription.model.js'

async function deleteRaphaelOwnedDataForUser(userId) {
  await Promise.all([
    BreachReport.deleteMany({ userId }),
    PrivacyRequest.deleteMany({ userId }),
    Subscription.deleteMany({ userId }),
    MicrosoftSubscription.deleteMany({ userId }),
  ])
}

export { deleteRaphaelOwnedDataForUser }
