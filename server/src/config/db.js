import mongoose from 'mongoose'
import { logEvent } from '../utils/logger.js'

async function connectDatabase(options = {}) {
  const mongoUri = process.env.MONGO_URI?.trim()

  if (!mongoUri) {
    throw new Error('MONGO_URI must be configured')
  }

  await mongoose.connect(mongoUri, options)
  logEvent('info', 'database_connected')
}

export default connectDatabase
