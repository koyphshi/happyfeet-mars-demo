Vendored from @noble/hashes 1.8.0 (MIT, Paul Miller, https://github.com/paulmillr/noble-hashes): esm/ files needed by blake3.js.
Only change: utils.js imports './crypto.js' instead of the bare specifier '@noble/hashes/crypto', so browsers can load it without an import map.
