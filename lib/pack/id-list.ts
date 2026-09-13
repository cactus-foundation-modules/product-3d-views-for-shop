// A list of ids, written for the wire.
//
// Product and model ids here are UUIDs, and a UUID spelled out as JSON is 39 bytes -
// 36 characters, two quotes and a comma - to say 16 bytes' worth. That stops being a
// rounding error the moment a list gets long: a desk range with 536 enabled variations
// put 20.9 KB of child ids on EVERY product card that showed it, and the product page's
// gallery carried 2,880 model ids at 112 KB.
//
// So a list whose ids are ALL canonical lowercase UUIDs travels as one string, each id
// its 16 bytes in URL-safe base64: 22 characters, no quotes, no commas. The same 536 ids
// are 11.8 KB. Anything else - a cuid, an id with a capital letter, one oddball among
// hundreds of UUIDs - sends the whole list as the plain array it always was, so nothing
// is ever re-spelled into an id the database would not recognise. All or nothing per
// list keeps the decoder to one question: string or array.
//
// Lossless by construction: the lowercase-and-dashes check is exactly what the
// decoder writes back, so a packed id can only ever come back as the string it was.

// A plain array of ids, or every id's 22-character base64url form run together.
export type PackedIdList = string | string[]

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const HEX_ALPHABET = '0123456789abcdef'
const PACKED_UUID_LENGTH = 22
// Where the dashes sit, counted in hex digits written so far.
const DASH_AFTER_HEX_DIGITS = new Set([8, 12, 16, 20])

// Each base64url character's six-bit value by char code, -1 for anything else. A
// lookup rather than indexOf because the browser unpacks thousands of these on a big
// product page, on the main thread, before the gallery can draw.
const SEXTET_BY_CHAR_CODE = new Int8Array(128).fill(-1)
for (let value = 0; value < BASE64URL_ALPHABET.length; value++) {
  SEXTET_BY_CHAR_CODE[BASE64URL_ALPHABET.charCodeAt(value)] = value
}

// 128 bits of UUID is 32 hex digits, four bits each, read into a small bit buffer and
// written out six bits at a time. 128 bits is 21 whole sextets and two bits over; the
// two are written as the top of a 22nd sextet whose low four bits are zero - exactly
// the padding standard base64 would add.
function packUuid(uuid: string): string {
  let packed = ''
  let buffer = 0
  let bufferedBits = 0
  for (let at = 0; at < uuid.length; at++) {
    const nibble = HEX_ALPHABET.indexOf(uuid.charAt(at))
    if (nibble < 0) continue // a dash
    buffer = (buffer << 4) | nibble
    bufferedBits += 4
    if (bufferedBits >= 6) {
      bufferedBits -= 6
      packed += BASE64URL_ALPHABET.charAt((buffer >> bufferedBits) & 0x3f)
      buffer &= (1 << bufferedBits) - 1
    }
  }
  return packed + BASE64URL_ALPHABET.charAt((buffer << (6 - bufferedBits)) & 0x3f)
}

function unpackUuid(packed: string, start: number): string {
  let uuid = ''
  let hexDigits = 0
  let buffer = 0
  let bufferedBits = 0
  for (let at = start; at < start + PACKED_UUID_LENGTH; at++) {
    const code = packed.charCodeAt(at)
    const sextet = code < 128 ? (SEXTET_BY_CHAR_CODE[code] ?? -1) : -1
    if (sextet < 0) throw new Error(`Packed id list holds a character outside base64url at position ${at}`)
    buffer = (buffer << 6) | sextet
    bufferedBits += 6
    while (bufferedBits >= 4 && hexDigits < 32) {
      bufferedBits -= 4
      if (DASH_AFTER_HEX_DIGITS.has(hexDigits)) uuid += '-'
      uuid += HEX_ALPHABET.charAt((buffer >> bufferedBits) & 0xf)
      buffer &= (1 << bufferedBits) - 1
      hexDigits++
    }
  }
  // What is left is the padding packUuid wrote. Anything but zero means the string
  // was never written by it.
  if (buffer !== 0) throw new Error(`Packed id at position ${start} is not a packed UUID`)
  return uuid
}

export function packIdList(ids: string[]): PackedIdList {
  if (!ids.every((id) => CANONICAL_UUID.test(id))) return ids
  return ids.map(packUuid).join('')
}

export function unpackIdList(packed: PackedIdList): string[] {
  if (Array.isArray(packed)) return packed
  if (packed.length % PACKED_UUID_LENGTH !== 0) {
    throw new Error(`Packed id list is ${packed.length} characters long, which is not a whole number of ids`)
  }
  const ids: string[] = []
  for (let at = 0; at < packed.length; at += PACKED_UUID_LENGTH) ids.push(unpackUuid(packed, at))
  return ids
}
