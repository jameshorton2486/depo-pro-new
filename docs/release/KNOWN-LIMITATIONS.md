# Known release limitations

- Reporter-selected digital exhibits are limited to PDF, PNG, and JPEG files no larger than 25 MB. Other formats and external exhibit repositories are not qualified.
- Artifact-generation serialization is single-process only and is not a distributed lock.
- Missing historical artifacts cannot be regenerated after authoritative state diverges; existing historical artifacts remain verifiable by immutable provenance.
- Certification Pages has no PDF button. PDF generation is qualified through the shared production server renderer.
- Real microphone capture, foot-pedal behavior, long-duration recording, crash/power-loss recovery, Word interoperability and physical printing remain workstation qualification gates.
- No email, recipient, delivery, cloud-storage or multi-user release workflow is asserted.
