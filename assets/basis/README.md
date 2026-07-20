# Basis Universal transcoder

`basis_transcoder.js` and `basis_transcoder.wasm`, copied verbatim from
`three/examples/jsm/libs/basis/` in the version of three this module is built against.
Binomial LLC's Basis Universal is licensed [Apache 2.0](https://github.com/BinomialLLC/basis_universal/blob/master/LICENSE);
the upstream project is at https://github.com/BinomialLLC/basis_universal .

They are here for exactly the reasons the Draco decoder next door is - see
`../draco/README.md`. Same argument, same shape of problem: `KTX2Loader` fetches these
two files by name from a directory URL rather than importing them, builds a Web Worker
out of the transcoder's source text, and hands the wasm binary to it. So they need to
sit at fixed names on a URL we control, which `app/api/decoders/[file]/route.ts` serves
them as.

## What they are for

A KTX2 texture stays compressed on the GPU. An ordinary PNG or JPEG in a glTF has to be
decoded to raw pixels before it can be uploaded, so a 2048x2048 map costs 16 MB of video
memory whatever its file size; the same map as KTX2 costs a fraction of that and uploads
faster. On a phone - where a product page is most likely to be opened and video memory is
most likely to run out - that is the difference between a model that appears and one that
takes the tab down with it.

Without a transcoder registered, `GLTFLoader` does not fall back to anything: it refuses
a file using `KHR_texture_basisu` outright, which reaches the admin as a model that
simply never appears. That is the same failure Draco and meshopt both had before their
decoders were wired up, and it is why this is registered even though nothing in Cactus
currently *writes* KTX2 - a site owner optimising their own models with gltfpack or
gltf-transform will produce them, and they should just work.

## Updating them

Copy both files again from `node_modules/three/examples/jsm/libs/basis/` after a three
upgrade, and keep them as a pair - the wrapper and the binary are two halves of one
transcoder, and a mismatched pair fails when a shopper opens a model rather than at build
time.
