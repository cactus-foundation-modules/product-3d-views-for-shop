import { readFile } from 'fs/promises'
import { join } from 'path'
import { NextResponse } from 'next/server'

// Serving this module's vendored WebAssembly decoders: Draco (compressed
// geometry) and Basis Universal (KTX2 compressed textures).
//
// Why routes at all, rather than importing the files: neither loader imports its
// decoder, both FETCH it. Given a directory url, DRACOLoader asks that directory
// for `draco_wasm_wrapper.js` (as text, which it turns into a Web Worker) and
// `draco_decoder.wasm` (as bytes, handed to that worker); KTX2Loader does the
// same with its own two filenames. Fixed filenames on a url we control is the
// whole contract, and a bundler-emitted asset - hashed into
// `static/media/draco_decoder.<hash>.wasm` - cannot satisfy it.
//
// three's own docs point at a Google CDN instead. A shop's product page should
// not stop working because a third party is having a bad afternoon, nor should a
// shopper's browser be sent to Google to find out what this site's furniture
// looks like. See the READMEs in assets/draco and assets/basis.
//
// The core's next.config.ts traces `./modules/*/assets/**` into the module API
// function (a generic glob, no module named in core), so these files reach the
// deployed bundle with nothing to configure per module.
//
// Public and unauthenticated on purpose: they are copies of Apache-2.0 decoders
// that any shopper's browser needs before it can draw a compressed model, and
// they say nothing about this shop.

// An allowlist, not a sanitised path. `file` arrives from the url, and the
// difference between "reject anything not on this list" and "strip the ../ out
// of it" is the difference between a route that cannot read arbitrary files and
// one that is only believed not to.
//
// Both decoders' files are served from one directory url because their filenames
// do not collide, and because a loader only ever asks for its own two.
const FILES: Record<string, { contentType: string; dir: string }> = {
  'draco_wasm_wrapper.js': { contentType: 'text/javascript; charset=utf-8', dir: 'draco' },
  'draco_decoder.wasm': { contentType: 'application/wasm', dir: 'draco' },
  'basis_transcoder.js': { contentType: 'text/javascript; charset=utf-8', dir: 'basis' },
  'basis_transcoder.wasm': { contentType: 'application/wasm', dir: 'basis' },
}

const ASSET_ROOT = join(process.cwd(), 'modules', 'product-3d-views-for-shop', 'assets')

// A day. Each decoder's two files are two halves of one thing and must match each
// other, so this is deliberately not `immutable`: a deploy that upgrades three
// replaces both, and a browser holding one half from before it would fail to
// decode. A day is long enough that a shopper browsing a catalogue fetches each
// decoder once, and short enough that a mismatched pair cannot outlive the
// afternoon.
const CACHE_CONTROL = 'public, max-age=86400'

export async function serveDecoderAsset(file: string): Promise<NextResponse> {
  const entry = FILES[file]
  if (!entry) return new NextResponse('Not found', { status: 404 })

  try {
    const bytes = await readFile(join(ASSET_ROOT, entry.dir, file))
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': entry.contentType,
        'Cache-Control': CACHE_CONTROL,
      },
    })
  } catch (error) {
    // Reachable only if the asset failed to reach the deployed bundle, which is a
    // deployment fault rather than a request the shopper got wrong. Logged
    // loudly, because the symptom at the other end is "compressed models will not
    // open" with nothing to say why.
    console.error(`[product-3d-views] could not read decoder asset "${file}":`, error)
    return new NextResponse('Decoder unavailable', { status: 500 })
  }
}
