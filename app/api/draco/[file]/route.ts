import { readFile } from 'fs/promises'
import { join } from 'path'
import { NextResponse } from 'next/server'

// Serves the two Draco decoder files this module ships in assets/draco, same-origin,
// at /api/m/product-3d-views-for-shop/draco/<file> .
//
// Why a route at all: DRACOLoader does not import its decoder, it FETCHES it. Given a
// directory url it asks that directory for `draco_wasm_wrapper.js` (as text, which it
// then turns into a Web Worker) and `draco_decoder.wasm` (as bytes, handed to that
// worker). Two fixed filenames on a url we control is the whole contract, and a
// bundler-emitted asset - hashed into `static/media/draco_decoder.<hash>.wasm` - cannot
// satisfy it. three's own docs point at a Google CDN instead; a shop's product page
// should not stop working because a third party is having a bad afternoon, nor should a
// shopper's browser be sent to Google to find out what this site's furniture looks like.
//
// The core's next.config.ts traces `./modules/*/assets/**` into the module API function
// (a generic glob, no module named in core), so these files reach the deployed bundle
// with nothing to configure per module.
//
// Public and unauthenticated on purpose: it is a copy of an Apache-2.0 decoder that any
// shopper's browser needs before it can draw a compressed model, and it says nothing
// about this shop.

// An allowlist, not a sanitised path. `file` arrives from the url, and the difference
// between "reject anything not on this list" and "strip the ../ out of it" is the
// difference between a route that cannot read arbitrary files and one that is only
// believed not to.
const FILES: Record<string, string> = {
  'draco_wasm_wrapper.js': 'text/javascript; charset=utf-8',
  'draco_decoder.wasm': 'application/wasm',
}

const ASSET_DIR = join(process.cwd(), 'modules', 'product-3d-views-for-shop', 'assets', 'draco')

// A day. The two files are two halves of one decoder and must match each other, so this
// is deliberately not `immutable`: a deploy that upgrades three replaces both, and a
// browser holding one half from before it would fail to decode. A day is long enough
// that a shopper browsing a catalogue fetches the decoder once, and short enough that a
// mismatched pair cannot outlive the afternoon.
const CACHE_CONTROL = 'public, max-age=86400'

export async function GET(_request: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params
  const contentType = FILES[file]
  if (!contentType) return new NextResponse('Not found', { status: 404 })

  try {
    const bytes = await readFile(join(ASSET_DIR, file))
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': CACHE_CONTROL,
      },
    })
  } catch (error) {
    // Reachable only if the asset failed to reach the deployed bundle, which is a
    // deployment fault rather than a request the shopper got wrong. Logged loudly,
    // because the symptom at the other end is "compressed models will not open" with
    // nothing to say why.
    console.error(`[product-3d-views] could not read Draco decoder asset "${file}":`, error)
    return new NextResponse('Decoder unavailable', { status: 500 })
  }
}
