import { describe, it, expect } from 'vitest'
import { packIdList, unpackIdList } from '@/modules/product-3d-views-for-shop/lib/pack/id-list'

// The packed form re-spells every id, so the one thing that matters is that the
// spelling always comes back letter for letter - an id that returns different is a
// variation the card viewer can no longer fetch.

const UUIDS = [
  '3a933e8f-b4dd-4405-a205-fe96df09a126',
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '104723f6-36e4-4002-82c9-4da56e3c3d2d',
  '0e0e699c-69ce-450f-969e-707e752a1316',
]

describe('packIdList', () => {
  it('packs a list of canonical UUIDs into one string of 22 characters an id', () => {
    const packed = packIdList(UUIDS)
    expect(typeof packed).toBe('string')
    expect(packed).toHaveLength(UUIDS.length * 22)
    expect(packed).toMatch(/^[A-Za-z0-9_-]*$/)
  })

  it('round-trips canonical UUIDs exactly, in order', () => {
    expect(unpackIdList(packIdList(UUIDS))).toEqual(UUIDS)
  })

  it('round-trips a thousand random UUIDs', () => {
    const ids = Array.from({ length: 1000 }, () => crypto.randomUUID())
    expect(unpackIdList(packIdList(ids))).toEqual(ids)
  })

  it('keeps duplicates, which a list of ids may legitimately hold', () => {
    const ids = [UUIDS[0]!, UUIDS[0]!, UUIDS[1]!]
    expect(unpackIdList(packIdList(ids))).toEqual(ids)
  })

  it('round-trips an empty list', () => {
    expect(unpackIdList(packIdList([]))).toEqual([])
  })

  // Anything that is not exactly what the decoder would write back stays a plain
  // array - the whole list, not just the odd one out.
  it.each([
    ['a cuid', 'ckl2x9f0x0000abcd1234efgh'],
    ['an upper-case UUID', '3A933E8F-B4DD-4405-A205-FE96DF09A126'],
    ['a UUID without dashes', '3a933e8fb4dd4405a205fe96df09a126'],
    ['a UUID in braces', '{3a933e8f-b4dd-4405-a205-fe96df09a126}'],
    ['an empty id', ''],
  ])('leaves the list as a plain array when it holds %s', (_label, oddOne) => {
    const ids = [UUIDS[0]!, oddOne, UUIDS[1]!]
    const packed = packIdList(ids)
    expect(Array.isArray(packed)).toBe(true)
    expect(unpackIdList(packed)).toEqual(ids)
  })

  it('refuses a packed string that is not a whole number of ids', () => {
    expect(() => unpackIdList('A'.repeat(23))).toThrow(/whole number of ids/)
  })

  it('refuses a packed id whose padding bits are not zero', () => {
    // '_' is 63: its low four bits set, which packUuid never writes last.
    expect(() => unpackIdList(`${'A'.repeat(21)}_`)).toThrow(/not a packed UUID/)
  })

  it('refuses a character outside base64url', () => {
    expect(() => unpackIdList(`${'A'.repeat(20)}+A`)).toThrow(/outside base64url/)
  })
})
