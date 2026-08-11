import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { Entry } from '@napi-rs/keyring'

const SERVICE = 'trueid-point-poker'
const ACCOUNT = 'host-master-key'
const ENV_KEY = 'TIPP_MASTER_KEY'
const ALGO = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12

/** @type {Buffer|null} */
let cachedKey = null

function keyringEntry() {
  return new Entry(SERVICE, ACCOUNT)
}

/**
 * 64-char hex → 32-byte key. Optional override when Keychain is unavailable.
 * @returns {Buffer|null}
 */
function keyFromEnv() {
  const raw = String(process.env[ENV_KEY] || '').trim()
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null
  return Buffer.from(raw, 'hex')
}

/**
 * @returns {Buffer}
 */
function loadOrCreateMasterKey() {
  if (cachedKey) return cachedKey

  const fromEnv = keyFromEnv()
  if (fromEnv) {
    cachedKey = fromEnv
    return cachedKey
  }

  const entry = keyringEntry()
  try {
    const existing = entry.getPassword()
    if (existing && /^[0-9a-fA-F]{64}$/.test(existing.trim())) {
      cachedKey = Buffer.from(existing.trim(), 'hex')
      return cachedKey
    }
  } catch {
  }

  const next = randomBytes(KEY_BYTES)
  const hex = next.toString('hex')
  try {
    entry.setPassword(hex)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Failed to store host master key in macOS Keychain (${SERVICE}/${ACCOUNT}): ${detail}. ` +
        `Unlock the login keychain for the pm2 user, or set ${ENV_KEY} to a 64-char hex key.`,
    )
  }
  cachedKey = next
  return cachedKey
}

/**
 * Encrypt plaintext → `iv.tag.ciphertext` (all base64, dot-separated).
 * @param {string} plaintext
 */
export function encryptSecret(plaintext) {
  const key = loadOrCreateMasterKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`
}

/**
 * @param {string} payload
 */
export function decryptSecret(payload) {
  const parts = String(payload || '').split('.')
  if (parts.length !== 3) throw new Error('Invalid encrypted secret format')
  const [ivB64, tagB64, dataB64] = parts
  const key = loadOrCreateMasterKey()
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const data = Buffer.from(dataB64, 'base64')
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/** Clear in-memory key (tests / rotate). */
export function clearMasterKeyCache() {
  cachedKey = null
}
