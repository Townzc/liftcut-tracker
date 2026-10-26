# Local recovery retention

The maintainer requested ongoing cleanup on 2026-10-26. Recovery material is not
an indefinitely growing collection of copied working directories.

1. Before deleting, inventory files and identify a verified retained recovery
   source. Resolve absolute paths, reject links/reparse points, and constrain
   every operation to the named backup root. Never delete by age alone.
2. Keep one physical copy per immutable model SHA-256. Retain unique baselines
   and candidates needed for published comparisons. Keep provenance, raw
   evaluation outputs, compact reports, licenses and original manifests.
3. Store an old-path → retained-path map with size and hash before deduplication.
   Rehash retained files after cleanup. Recovery instructions must use the map;
   do not claim an old directory is still self-contained after deleting copies.
4. Prefer Git bundles plus source manifests. Keep the latest two independently
   verified source recovery points and every full base required by retained
   incremental bundles. A verified Git revision replaces repeated source trees.
5. Exclude node_modules, build/JS exports, .next, download caches and disposable
   restoration/rehearsal copies. Verify the restored destination first, then
   clean temporary large files in the same round and retain compact receipts.
6. Record deleted bytes, keeper hashes, restoration results and exceptions.
   A unique result or an only recovery point needs explicit retention review;
   an old label alone is not evidence that it can be removed.

## 2026-10-26 workstation cleanup

- Root: `E:\LiftCutBackups`. Deleted 61 byte-identical weight duplicates:
  46,075,171,592 bytes (42.91 GiB). All 26 unique keepers rehashed successfully.
- No unique weight, Git object, source bundle or archive part was deleted.
- `README.md`, `deduplication-2026-10-26.json`, deletion receipts and
  `Resolve-Backup.ps1` are kept at that root. The resolver verifies the retained
  hash, rejects escaping paths, and returns a path without making another copy.
- Restored one 1,198,182,144-byte GGUF through its old-path mapping, verified the
  expected SHA-256 and removed the temporary restored copy. This is a sampled
  restoration check plus full keeper hashing, not a new GPU/model evaluation.
- The detailed local inventory and execution logs are in the task's
  `deliverables/2026-10-26-mobile-native-acceptance` folder, outside Git. Do not
  upload private backup payloads, credentials or model weights to the repository.
