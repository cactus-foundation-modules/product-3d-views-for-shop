import { describe, expect, it } from 'vitest'
import { serveDecoderAsset } from '@/modules/product-3d-views-for-shop/lib/decoder-assets'

// The allowlist on the public decoder route. Nothing here reads a file - the
// assets are not in the test environment - so these check the REFUSALS, which
// is the half that matters.

describe('serveDecoderAsset', () => {
  it('refuses a filename that is not on the list', async () => {
    expect((await serveDecoderAsset('anything.wasm')).status).toBe(404)
  })

  it('refuses a traversal attempt outright', async () => {
    expect((await serveDecoderAsset('../../../.env')).status).toBe(404)
    expect((await serveDecoderAsset('/etc/passwd')).status).toBe(404)
  })

  // The one this changed: a plain object literal answers truthily for anything
  // on Object.prototype, so these used to fall through the allowlist and 500 on
  // a join with undefined instead of saying 404.
  it('refuses the names every object has', async () => {
    for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect((await serveDecoderAsset(name)).status).toBe(404)
    }
  })

  it('refuses an empty name', async () => {
    expect((await serveDecoderAsset('')).status).toBe(404)
  })
})
