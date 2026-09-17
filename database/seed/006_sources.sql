-- WorthAGo Database
-- Seed: Sources
--
-- Stable provider/source definitions required by WorthAGo.
-- Operational fields such as last_checked_at and last_changed_at
-- are intentionally not seeded.

INSERT INTO sources (
    id,
    place_id,
    source_type,
    url,
    title,
    language_code,
    is_authoritative,
    status
) VALUES (
    8,
    NULL,
    'official_website',
    'https://www.cinemas.nos.pt/',
    'Cinemas NOS',
    'pt-PT',
    1,
    'active'
);
