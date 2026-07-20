# Draco decoder

`draco_wasm_wrapper.js` and `draco_decoder.wasm`, copied verbatim from
`three/examples/jsm/libs/draco/gltf/` in the version of three this module is built
against. Google's Draco is licensed [Apache 2.0](https://github.com/google/draco/blob/master/LICENSE);
the upstream project is at https://github.com/google/draco .

They are here rather than fetched from a CDN because a shop's product page must not
depend on a third party being up, and because a shopper's browser should not be told
to go and ask Google what this site's furniture looks like.

They are here rather than imported through the bundler because `DRACOLoader` does not
load them as modules: it fetches them by name from a directory URL, builds a Web Worker
out of the wrapper's source text and hands the wasm binary to it. So it needs two files
sitting at fixed names on a URL we control - which is what `app/api/draco/[file]/route.ts`
serves them as, under `/api/m/product-3d-views-for-shop/draco/`.

`modules/*/assets/**` is traced into the module API function by the core's
`next.config.ts`, so these reach the deployed bundle with no per-module config.

## Updating them

Copy both files again from `node_modules/three/examples/jsm/libs/draco/gltf/` after a
three upgrade, and keep them as a pair - the wrapper and the binary are two halves of
one decoder, and a mismatched pair fails when a shopper opens a model rather than at
build time. The `gltf/` subdirectory is the right one: it is the decoder trimmed to what
glTF actually uses, and is roughly a third smaller than the general-purpose build beside
it. The `.js`-only decoder three also ships is deliberately not copied - it is 500 kB to
serve a browser old enough to lack WebAssembly, which is older than anything that can
run this viewer at all.
