/*
 * PTLife — Cinemas NOS Theater Synchronizer v2
 *
 * PRODUCTION DATA WRITES.
 *
 * Improvements over v1:
 * - safeRun reliability framework
 * - validates provider data before D1 writes
 * - batches updates for existing theaters
 * - separately times provider fetch / D1 read / D1 writes
 * - creates genuinely new theaters safely
 * - never deletes a theater merely because it disappears
 */

import { safeRun } from "../lib/safe-run.js";

const NOS_SOURCE_ID = 8;

const NOS_ORIGIN =
  "https://www.cinemas.nos.pt";

const THEATERS_URL =
  NOS_ORIGIN +
  "/graphql/execute.json/cinemas/" +
  "getAllTheatersWithoutRegion";


function respond(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",
        "cache-control":
          "no-store"
      }
    }
  );
}


function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}


function parseLocation(value) {
  if (!value) {
    return {
      latitude: null,
      longitude: null
    };
  }

  const parts =
    String(value).split(",");

  if (parts.length !== 2) {
    return {
      latitude: null,
      longitude: null
    };
  }

  const latitude =
    Number(parts[0].trim());

  const longitude =
    Number(parts[1].trim());

  return {
    latitude:
      Number.isFinite(latitude)
        ? latitude
        : null,

    longitude:
      Number.isFinite(longitude)
        ? longitude
        : null
  };
}


function inferCity(theater) {

  /*
   * Two NOS addresses need explicit normalization.
   */

  const byUuid = {
    "54b58378-917a-45b3-ab7b-890ae6b567cb":
      "Alcabideche",

    "bd354975-cb8a-4c2d-8a9b-6e87782e0915":
      "Loulé"
  };


  if (byUuid[theater?.uuid]) {
    return byUuid[theater.uuid];
  }


  const address =
    String(
      theater?.address?.plaintext || ""
    );


  const candidates = [
    ["Lisboa", "Lisboa"],
    ["Porto", "Porto"],
    ["Coimbra", "Coimbra"],
    ["Faro", "Faro"],
    ["Funchal", "Funchal"],
    ["Braga", "Braga"],
    ["Évora", "Évora"],
    ["Aveiro", "Aveiro"],
    ["Leiria", "Leiria"],
    ["Viseu", "Viseu"],
    ["Montijo", "Montijo"],
    ["Odivelas", "Odivelas"],
    ["Oeiras", "Oeiras"],
    ["Almada", "Almada"],
    ["Matosinhos", "Matosinhos"],
    ["Portimão", "Portimão"],
    ["Portimao", "Portimão"],
    ["Torres Vedras", "Torres Vedras"],
    ["Ponta Delgada", "Ponta Delgada"],
    ["Vila Real", "Vila Real"],
    ["Figueira da Foz", "Figueira da Foz"],
    ["Gaia", "Vila Nova de Gaia"],
    ["Gondomar", "Gondomar"],
    ["Paços de Ferreira", "Paços de Ferreira"]
  ];


  for (const [needle, city] of candidates) {
    if (
      address
        .toLowerCase()
        .includes(
          needle.toLowerCase()
        )
    ) {
      return city;
    }
  }


  return null;
}


async function fetchTheaters() {

  const started =
    Date.now();


  const response =
    await fetch(
      THEATERS_URL,
      {
        headers: {
          accept:
            "application/json"
        }
      }
    );


  const text =
    await response.text();


  if (!response.ok) {

    const error =
      new Error(
        `NOS theater inventory HTTP ${response.status}`
      );

    error.httpStatus =
      response.status;

    error.preview =
      text.slice(0, 1000);

    throw error;
  }


  let data;

  try {
    data =
      JSON.parse(text);
  } catch {
    throw new Error(
      "NOS theater inventory returned invalid JSON"
    );
  }


  const theaters =
    data
      ?.data
      ?.theaterList
      ?.items;


  if (!Array.isArray(theaters)) {
    throw new Error(
      "NOS schema changed: expected data.theaterList.items"
    );
  }


  /*
   * Protect against a technically valid but
   * suspiciously incomplete provider response.
   */

  if (theaters.length < 20) {
    throw new Error(
      `NOS returned suspicious theater count: ${theaters.length}`
    );
  }


  const invalid =
    theaters.filter(
      theater =>
        !theater?.uuid ||
        !theater?.name
    );


  if (invalid.length) {
    throw new Error(
      `NOS returned ${invalid.length} theater records without UUID/name`
    );
  }


  const ids =
    new Set(
      theaters.map(
        theater =>
          theater.uuid
      )
    );


  if (ids.size !== theaters.length) {
    throw new Error(
      "NOS returned duplicate theater UUIDs"
    );
  }


  return {
    theaters,

    fetch_ms:
      Date.now() - started
  };
}


/*
 * ----------------------------------------------------------
 * SYNCHRONIZE VALIDATED INVENTORY
 * ----------------------------------------------------------
 */

async function synchronizeTheaters(
  db,
  theaters
) {

  const d1ReadStarted =
    Date.now();


  const existingResult =
    await db.prepare(`
      SELECT
        ps.id AS place_source_id,
        ps.place_id,
        ps.external_id,
        ps.status AS source_status,
        p.slug,
        p.official_name
      FROM place_sources ps
      JOIN places p
        ON p.id = ps.place_id
      WHERE ps.source_id = ?
    `)
    .bind(NOS_SOURCE_ID)
    .all();


  const existing =
    existingResult.results || [];


  const d1ReadMs =
    Date.now() - d1ReadStarted;


  const existingByUuid =
    new Map(
      existing.map(
        row => [
          row.external_id,
          row
        ]
      )
    );


  const currentIds =
    new Set(
      theaters.map(
        theater =>
          theater.uuid
      )
    );


  const updated = [];
  const created = [];
  const unresolved = [];

  const knownTheaters = [];
  const newTheaters = [];


  /*
   * Split known and new provider identities.
   */

  for (const theater of theaters) {

    const city =
      inferCity(theater);

    if (!city) {
      unresolved.push({
        uuid:
          theater.uuid,

        name:
          theater.name,

        address:
          theater?.address?.plaintext ||
          null,

        issue:
          "city_not_resolved"
      });
    }


    if (
      existingByUuid.has(
        theater.uuid
      )
    ) {
      knownTheaters.push(theater);
    } else {
      newTheaters.push(theater);
    }
  }


  /*
   * --------------------------------------------------------
   * FAST PATH — UPDATE ALL KNOWN THEATERS IN ONE D1 BATCH
   * --------------------------------------------------------
   */

  const batchStarted =
    Date.now();


  const statements = [];


  for (const theater of knownTheaters) {

    const existingLink =
      existingByUuid.get(
        theater.uuid
      );

    const coordinates =
      parseLocation(
        theater.location
      );

    const city =
      inferCity(theater);

    const address =
      theater
        ?.address
        ?.plaintext ||
      null;


    statements.push(

      db.prepare(`
        UPDATE places
        SET
          official_name = ?,
          original_language = 'pt-PT',
          place_type = 'cinema',
          city = ?,
          country_code = 'PT',
          address = ?,
          latitude = ?,
          longitude = ?,
          official_website = ?,
          status = 'active',
          updated_at =
            CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(
        theater.name,
        city,
        address,
        coordinates.latitude,
        coordinates.longitude,
        NOS_ORIGIN + "/",
        existingLink.place_id
      )

    );


    statements.push(

      db.prepare(`
        UPDATE place_sources
        SET
          source_url = ?,
          status = 'active',
          last_verified_at =
            CURRENT_TIMESTAMP,
          updated_at =
            CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(
        NOS_ORIGIN + "/",
        existingLink.place_source_id
      )

    );


    updated.push({
      place_id:
        existingLink.place_id,

      uuid:
        theater.uuid,

      name:
        theater.name
    });
  }


  if (statements.length) {
    await db.batch(statements);
  }


  const batchUpdateMs =
    Date.now() - batchStarted;


  /*
   * --------------------------------------------------------
   * NEW THEATERS
   * --------------------------------------------------------
   *
   * This is deliberately a slower path because we need
   * the generated places.id before creating place_sources.
   *
   * Normally this array will be empty.
   */

  const creationStarted =
    Date.now();


  for (const theater of newTheaters) {

    const coordinates =
      parseLocation(
        theater.location
      );

    const city =
      inferCity(theater);

    const address =
      theater
        ?.address
        ?.plaintext ||
      null;

    const baseSlug =
      slugify(
        theater.name
      );


    /*
     * Conservative reuse of an existing
     * manually-created place.
     */

    const sameSlug =
      await db.prepare(`
        SELECT
          id,
          official_name
        FROM places
        WHERE slug = ?
        LIMIT 1
      `)
      .bind(baseSlug)
      .first();


    let placeId;
    let reusedExistingPlace =
      false;


    if (sameSlug) {

      placeId =
        sameSlug.id;

      reusedExistingPlace =
        true;


      await db.prepare(`
        UPDATE places
        SET
          official_name = ?,
          original_language = 'pt-PT',
          place_type = 'cinema',
          city = ?,
          country_code = 'PT',
          address = ?,
          latitude = ?,
          longitude = ?,
          official_website = ?,
          status = 'active',
          updated_at =
            CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(
        theater.name,
        city,
        address,
        coordinates.latitude,
        coordinates.longitude,
        NOS_ORIGIN + "/",
        placeId
      )
      .run();

    } else {

      const insert =
        await db.prepare(`
          INSERT INTO places (
            slug,
            place_type,
            official_name,
            original_language,
            city,
            country_code,
            address,
            latitude,
            longitude,
            official_website,
            status
          )
          VALUES (
            ?,
            'cinema',
            ?,
            'pt-PT',
            ?,
            'PT',
            ?,
            ?,
            ?,
            ?,
            'active'
          )
        `)
        .bind(
          baseSlug,
          theater.name,
          city,
          address,
          coordinates.latitude,
          coordinates.longitude,
          NOS_ORIGIN + "/"
        )
        .run();


      placeId =
        insert.meta.last_row_id;
    }


    await db.prepare(`
      INSERT INTO place_sources (
        place_id,
        source_id,
        external_id,
        source_url,
        status,
        last_verified_at
      )
      VALUES (
        ?,
        ?,
        ?,
        ?,
        'active',
        CURRENT_TIMESTAMP
      )
    `)
    .bind(
      placeId,
      NOS_SOURCE_ID,
      theater.uuid,
      NOS_ORIGIN + "/"
    )
    .run();


    created.push({
      place_id:
        placeId,

      uuid:
        theater.uuid,

      name:
        theater.name,

      reused_existing_place:
        reusedExistingPlace
    });
  }


  const creationMs =
    Date.now() - creationStarted;


  /*
   * Missing means:
   *
   * "previously known through NOS, but not in today's
   * successful inventory."
   *
   * We DO NOT alter the place.
   */

  const missing =
    existing
      .filter(
        row =>
          !currentIds.has(
            row.external_id
          )
      )
      .map(
        row => ({
          place_id:
            row.place_id,

          external_id:
            row.external_id,

          name:
            row.official_name,

          previous_source_status:
            row.source_status
        })
      );


  return {
    provider_theaters:
      theaters.length,

    previously_known:
      existing.length,

    created:
      created.length,

    updated:
      updated.length,

    missing_from_current_inventory:
      missing.length,

    unresolved:
      unresolved.length,

    details: {
      created,
      updated,
      missing_from_current_inventory:
        missing,
      unresolved
    },

    timing: {
      d1_read_ms:
        d1ReadMs,

      d1_batch_update_ms:
        batchUpdateMs,

      d1_new_theater_creation_ms:
        creationMs
    }
  };
}


/*
 * ----------------------------------------------------------
 * REQUEST
 * ----------------------------------------------------------
 */

export async function onRequestGet(context) {

  const db =
    context.env.DB;

  const requestStarted =
    Date.now();


  /*
   * safeRun now owns provider reliability.
   */

  const result =
    await safeRun({

      db,

      provider:
        "cinemas_nos",

      operation:
        "sync_theaters",

      stage:
        "theater_synchronization",

      sourceFile:
        "functions/api/nos-theaters-sync.js",

      request:
        context.request,

      reproduction:
        "GET /api/nos-theaters-sync",

      fallbackData: {
        inventory: null,
        theaters: []
      },


      /*
       * Provider + synchronization operation.
       */

      run:
        async () => {

          /*
           * Fetch and completely validate NOS
           * BEFORE database synchronization.
           */

          const provider =
            await fetchTheaters();


          const synchronization =
            await synchronizeTheaters(
              db,
              provider.theaters
            );


          return {
            fetched_at:
              new Date().toISOString(),

            provider_fetch_ms:
              provider.fetch_ms,

            inventory:
              {
                provider_theaters:
                  synchronization
                    .provider_theaters,

                previously_known:
                  synchronization
                    .previously_known,

                created:
                  synchronization
                    .created,

                updated:
                  synchronization
                    .updated,

                missing_from_current_inventory:
                  synchronization
                    .missing_from_current_inventory,

                unresolved:
                  synchronization
                    .unresolved
              },

            created:
              synchronization
                .details
                .created,

            updated:
              synchronization
                .details
                .updated,

            missing_from_current_inventory:
              synchronization
                .details
                .missing_from_current_inventory,

            unresolved:
              synchronization
                .details
                .unresolved,

            timing:
              synchronization
                .timing,

            safety: {
              missing_theaters_deleted:
                false,

              missing_theaters_closed:
                false,

              provider_identity:
                "source_id + external_id",

              minimum_inventory_required:
                20
            }
          };
        },


      /*
       * This is a second defensive validation
       * layer inside safeRun.
       */

      validate:
        result => {

          if (
            !result?.inventory ||
            result
              .inventory
              .provider_theaters < 20
          ) {
            throw new Error(
              "NOS theater synchronization produced an invalid inventory"
            );
          }

          return true;
        },


      getItemCount:
        result =>
          result
            ?.inventory
            ?.provider_theaters ??
          null,


      getMetadata:
        result => ({
          source_id:
            NOS_SOURCE_ID,

          provider_fetch_ms:
            result
              ?.provider_fetch_ms ??
            null,

          d1_read_ms:
            result
              ?.timing
              ?.d1_read_ms ??
            null,

          d1_batch_update_ms:
            result
              ?.timing
              ?.d1_batch_update_ms ??
            null,

          created:
            result
              ?.inventory
              ?.created ??
            null,

          updated:
            result
              ?.inventory
              ?.updated ??
            null,

          missing:
            result
              ?.inventory
              ?.missing_from_current_inventory ??
            null
        })
    });


  /*
   * safeRun returns a predictable object regardless
   * of provider success/failure.
   */

  return respond({

    ...result,

    synchronization:
      result.ok,

    total_request_ms:
      Date.now() - requestStarted,

    graceful_failure:
      !result.ok,

    next_step:
      result.ok
        ? "Compare timing with v1. If the batch synchronization is healthy and fast, proceed to NOS movie/showtime ingestion."
        : "The failure was handled by PTLife reliability. Inspect system_errors and provider_health."

  });
}
