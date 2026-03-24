import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { TOKEN_ENCRYPT_KEY } from './config'

const ALGORITHM = 'aes-256-gcm'

// Encrypt a token for storage in the database
export function encryptToken(plaintext: string): string {
  if (!TOKEN_ENCRYPT_KEY) throw new Error('TOKEN_ENCRYPTION_KEY env var is not set')
  const key = Buffer.from(TOKEN_ENCRYPT_KEY, 'hex')  // 32 bytes
  const iv  = randomBytes(12)                         // 96-bit IV for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag   = cipher.getAuthTag()

  // Store as: iv(24 hex) + authTag(32 hex) + ciphertext(hex)
  return iv.toString('hex') + authTag.toString('hex') + encrypted.toString('hex')
}

// Decrypt a token retrieved from the database
export function decryptToken(ciphertext: string): string {
  const key     = Buffer.from(TOKEN_ENCRYPT_KEY, 'hex')
  const iv      = Buffer.from(ciphertext.slice(0, 24), 'hex')
  const authTag = Buffer.from(ciphertext.slice(24, 56), 'hex')
  const data    = Buffer.from(ciphertext.slice(56), 'hex')

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return decipher.update(data).toString('utf8') + decipher.final('utf8')
}
