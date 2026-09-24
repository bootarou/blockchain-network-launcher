# Local Chain Recovery

For the Japanese incident analysis, evidence and successful manual recovery,
see [2026-09-23 broker recovery report](incident-2026-09-23-broker-recovery.ja.md).

The Operations page's crash recovery command now rebuilds local state and
MongoDB on a copy instead of automatically resetting to the nemesis seed.
This follows the single-node recovery exercised on September 23, 2026.

## Supported Configuration

- Linux/WSL manager with a local Docker daemon and identical absolute target
  paths inside the manager and on the Docker host (bind mounts).
- One `api-node-0`, matching server/broker images, `fileDatabaseBatchSize=1`,
  cache database storage and verifiable state enabled, database `catapult`,
  MongoDB `mongo:5.0.15` actually using `--dbpath=/dbdata`.
- Non-PQC images: `symbolplatform/symbol-server:gcc-1.0.3.9`,
  `symbol-server-patched:gcc-1.0.3.9`, or
  `nftdrive/bnl-catapult-server:1.0.3.9-cf1-ebp`.
- Other images/versions, PQC, multi-node layouts, symlinked node trees and
  remote Docker contexts are not supported. No image is pulled during recovery.
- Complete readable local blocks are required. This cannot restore missing or
  corrupt blocks. It does not repair a damaged backup ZIP.

## Workflow

1. Stop node, broker, REST and database. Leave the BNL manager running.
2. Choose crash diagnosis/recovery and confirm preparation. The operation runs
   in the backend, independently of browser/SSH lifetime. Status can be reopened.
3. A private workspace under `TARGET_DIR/local-recovery/<job-id>` receives a
   copy of the node. Derived state, locks and queues are moved aside **on the
   copy only**. Voting state, key trees and original configuration are retained.
4. The native importer replays the blocks with no network. The broker consumes
   regenerated queues into a fresh MongoDB on an internal Docker network with
   no published ports. Originals remain untouched.
5. Validation requires clean exits, drained queues, the expected block count,
   highest block height, original stored block hash, and importer-calculated
   state hash matching the last block's recorded state hash. MongoDB and broker
   are restarted and checked again. This is not an independent recomputation
   of every MongoDB document, nor a reconstruction of transient transaction statuses.
6. Choose **Apply Verified Data**. Both datasets are switched using same-filesystem
   renames. Originals remain in `<job-id>/original-before-cutover/{node-data,mongo-db}`.
   Test containers are removed before moving their bind mounts. Certificates and
   live configuration are not replaced. The node is left stopped.
7. Use normal Start, not full configuration regeneration. Verify `/node/health`,
   advancing `/chain/info`, finalization, and peer synchronization. Take and
   validate a new full backup before considering manual deletion of retained data.

## Failures and Interruption

- No automatic seed fallback or recovery-data pruning. Start refuses diagnosed
  damage; lock removal also refuses damage requiring a rebuild.
- Missing or empty pending spool messages are detected using writer/reader
  indices. Block groups use decimal 10000-height boundaries.
- Mutating BNL APIs are locked for the job, including backups, reset and start.
  Reading status and downloading existing backup files remains possible.
- A failure retains originals and workspace, and holds the maintenance lock.
  **End Job and Release Lock** stops/removes labelled helpers without deleting
  files. Retrying creates a new workspace and starts from the beginning.
- A manager restart during preparation marks the job interrupted. Detached
  helpers may still be running. Release the job through the UI before retrying;
  do not restart the original node or helper containers manually.
- A manager/host crash during cutover, or an unreadable recovery journal, requires
  manual inspection and keeps mutations locked. There is intentionally no
  force-unlock API for an ambiguous node/DB pair. Inspect the journal
  `shared/local-recovery.json`, workspace and saved directories first.
- Ordinary rename failures attempt reverse-order rollback. This is not a
  power-loss-atomic transaction across two directories. Do not delete the journal
  simply to bypass the maintenance lock.
- No cancellation while preparation is actively running. Browser disconnection
  does not cancel it. Docker logs and the status panel show the current phase.
- Minimum preflight space estimate: 4x node apparent size + 2 GiB. This is only
  an estimate; monitor actual filesystem and Windows host disk capacity too.
- Manual Docker operations bypass BNL's lock. Do not start or change any node
  containers/configuration while recovery is in progress.

## API

- `POST /api/commands/crashRecovery` prepares and returns HTTP 202 with a job.
- `GET /api/recovery` returns persisted status and the maintenance-lock state.
- `POST /api/recovery/apply` and `/abandon` accept `{ "id": "<job-id>" }`.
- The legacy explicit `{ "resetData": true }` recovery request remains a separate
  destructive seed-reset operation with its existing resync-source checks. The
  crash-recovery UI no longer submits it or silently falls back to it.

The implementation needs an end-to-end test on a disposable Linux copy before
production use. Never exercise failure injection against the recovered live node.
