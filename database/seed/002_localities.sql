-- PTLife Database
-- Seed: Localities
--
-- Initial geographic hierarchy for Portugal.

INSERT INTO localities (
    id,
    parent_locality_id,
    country_id,
    locality_type,
    name,
    name_english,
    slug,
    latitude,
    longitude,
    timezone
) VALUES
(
    1,
    NULL,
    1,
    'metropolitan_area',
    'Área Metropolitana de Lisboa',
    'Lisbon Metropolitan Area',
    'lisbon-metropolitan-area',
    38.75,
    -9.2,
    'Europe/Lisbon'
),
(
    2,
    1,
    1,
    'city',
    'Lisboa',
    'Lisbon',
    'lisbon',
    38.7223,
    -9.1393,
    'Europe/Lisbon'
),
(
    3,
    2,
    1,
    'neighborhood',
    'Belém',
    'Belém',
    'belem',
    38.6977,
    -9.2064,
    'Europe/Lisbon'
);
