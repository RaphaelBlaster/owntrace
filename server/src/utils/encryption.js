import crypto from 'node:crypto'
import { getTokenEncryptionKey } from '../config/google.js'

function encryptSecret(value) {
  if (!value) return null

  const initializationVector = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getTokenEncryptionKey(), initializationVector)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const authenticationTag = cipher.getAuthTag()

  return [
    'v1',
    initializationVector.toString('base64url'),
    authenticationTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.')
}

function decryptSecret(value) {
  if (!value) return null

  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split('.')

  if (version !== 'v1' || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error('Encrypted value has an unsupported format')
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getTokenEncryptionKey(),
    Buffer.from(encodedIv, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export { decryptSecret, encryptSecret }
