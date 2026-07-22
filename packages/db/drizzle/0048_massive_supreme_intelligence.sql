-- The physical rename is a coordinated post-deploy cutover in raw migration 0080.
-- Keeping this journal entry side-effect free lets a clean database replay all
-- earlier security overlays before the final name becomes authoritative.
select 1;
