# P1-M CPU preparation evidence

These are **scripted preparation observations, zero model calls**. The real
PostgreSQL application and pinned tokenizer ran locally. Neither a production
identity provider nor an AutoDL model was contacted.

- `readiness.json`: source freeze, checks, stage size and explicit limitations.
- `summary.json`: 24 known workflows, 120 scripted decisions, 9 attempts / 9 writes.
- `scripted-evidence.tar.gz`: byte-exact original 24 cases, every checkpoint,
  actual process identities, native serialization, inventory and real database
  dump. All identities and plans are synthetic. There are no weights or passwords.
- `backup-receipt.json`: actual private parent hashes read locally, 120 token
  reconstructions, real fresh database restoration and SQL replay. Its
  `complete_model_receipt` is **false** and the server rejects it as a model ACK.
- `database-replay.json` / `replay-process.json`: actual successful restoration.
- `engineering.log`: 31 real database / API / model-bridge checks.
- `protocol-tests.log`: 11 native, original-deadline, partial and failure checks.
- `lint.log`: zero errors, two unchanged historical warnings.
- `sha256.json`: eleven public file hashes, including source portability; this explanatory README is not
  an experimental observation.

The three application restarts are **planned checkpointed process exits**, not
crashes. Earlier P1 separately exercised a post-commit SIGKILL and actual browser
response loss. Here the lost-result scenario hides a tool result after a real SQL
commit; it is not another physical network-fault measurement. Preview/no-reply
share an observable state, and the three bundles share the workflow templates.

Reproduction requires a disposable loopback PostgreSQL database with the P1 schema,
Node dependencies, and the pinned tokenizer. Run `tools/check_p1m_publication.py
--extract-dir <new-directory>`, then `research/p1-model/restore.py restore
--directory <new-directory> --output <new-restore-directory> --tokenizer-dir
<pinned-tokenizer>`. CI omits `--parent` and therefore makes no new private-weight
verification claim. The original local receipt records that separate actual check.

See [design, failures and next trigger](../../../../docs/research/2026-10-13-p1m-readiness.md).

最终源码跨平台核验另见[source-portability.json](source-portability.json)：15个既有依赖只做CRLF→LF规范化，每个等于既有Git对象，旧146源与原CPU证据不改。当前代码包417116字节，原417512字节包保留在ignored输出；当前SHA清单共11份文件。
