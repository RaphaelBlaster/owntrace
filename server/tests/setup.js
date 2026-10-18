import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, afterEach, beforeAll } from 'vitest'

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'owntrace-test-secret-that-is-longer-than-thirty-two-characters'
process.env.CLIENT_ORIGINS = 'http://localhost:5173'
process.env.CLIENT_APP_URL = 'http://localhost:5173'
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com'
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret'
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:5000/api/google/oauth/callback'
process.env.MICROSOFT_CLIENT_ID = 'test-microsoft-client-id'
process.env.MICROSOFT_CLIENT_SECRET = 'test-microsoft-client-secret'
process.env.MICROSOFT_REDIRECT_URI = 'http://localhost:5000/api/microsoft/oauth/callback'
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

let mongoServer

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create()
  await mongoose.connect(mongoServer.getUri())
})

afterEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})),
  )
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer?.stop()
})
