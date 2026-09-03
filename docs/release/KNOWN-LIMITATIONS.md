# Known release limitations

- Digital exhibit lifecycle is supported for eligible files already inside authoritative deposition storage; the reporter UI does not yet provide qualified digital exhibit file intake/selection.
- Artifact-generation serialization is single-process only and is not a distributed lock.
- Missing historical artifacts cannot be regenerated after authoritative state diverges; existing historical artifacts remain verifiable by immutable provenance.
- Certification Pages has no PDF button. PDF generation is qualified through the shared production server renderer.
- Real microphone capture, foot-pedal behavior, long-duration recording, crash/power-loss recovery, Word interoperability and physical printing remain workstation qualification gates.
- No email, recipient, delivery, cloud-storage or multi-user release workflow is asserted.
