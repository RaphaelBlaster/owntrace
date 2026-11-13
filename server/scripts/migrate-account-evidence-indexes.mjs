import 'dotenv/config'
import mongoose from 'mongoose'
import connectDatabase from '../src/config/db.js'
import AccountEvidence from '../src/models/account-evidence.model.js'

await connectDatabase()

const indexes = await AccountEvidence.collection.indexes()
for (const index of indexes) {
  if (index.name === '_id_') continue
  const isLegacyGmailUnique = index.name === 'userId_1_gmailSignalId_1' && index.unique && !index.partialFilterExpression
  if (isLegacyGmailUnique) await AccountEvidence.collection.dropIndex(index.name)
}

await AccountEvidence.syncIndexes()
console.log('AccountEvidence indexes synchronized.')
await mongoose.disconnect()
