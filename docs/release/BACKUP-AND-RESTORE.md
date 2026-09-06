# Backup and restore

Stop recording and editing before backup. Use removable or otherwise independent local storage for the destination.

Create: `npm run backup -- create --deposition-id DEP-... --destination "E:\\DepoPro Backups"`

Verify: `npm run backup -- verify --backup "E:\\DepoPro Backups\\DepoPro-..."`

Restore into an empty configured storage root: `npm run backup -- restore --backup "E:\\DepoPro Backups\\DepoPro-..."`

Each backup contains every file in the deposition plus a manifest of file sizes and SHA-256 digests. Creation fails if source bytes change during copying. Verification detects missing, added or changed bytes. Restore never overwrites an existing deposition and verifies restored bytes against the manifest.

A backup is not proven merely because its folder exists. Run `verify` and retain the successful output as the operational record.
