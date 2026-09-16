/*
 * PTLife — Cinemas NOS Theater Synchronizer v1
 *
 * PRODUCTION DATA WRITES.
 *
 * Synchronizes the official NOS theater inventory with PTLife.
 *
 * Safety:
 * - identifies theaters by NOS source_id + theater UUID
 * - updates existing theaters
 * - creates new theaters
 * - does NOT delete theaters missing from a NOS response
 * - rejects suspicious/empty provider responses
 * - reports unresolved locality information
 * - reports theaters that disappeared from the current NOS inventory
 */

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


/*
 * Temporary locality normalization.
 *
 * Eventually this should move into PTLife's
 * general locality/geographic normalization
 * system.
 *
 * For now, these values come from the official
 * NOS inventory we already inspected.
 */
function inferCity(theater) {

  const byUuid = {

    /*
     * NOS addresses don't make these two
     * cities sufficiently obvious.
     */

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


  let data = null;

  try {
    data =
      JSON.parse(text);
  } catch {
    // handled below
  }


  return {
    ok:
      response.ok,

    status:
      response.status,

    data,

    preview:
      text.slice(0, 1500),

    duration_ms:
      Date.now() - started
  };
}


export async function onRequestGet(context) {

  const db =
    context.env.DB;

  const started =
    Date.now();


  try {

    /*
     * --------------------------------------
     * 1. FETCH CURRENT NOS INVENTORY
     * --------------------------------------
     */

    const provider =
      await fetchTheaters();


    if (!provider.ok) {

      return respond({
        ok: false,
        graceful_failure: true,
        provider:
          "Cinemas NOS",
        stage:
          "theater_inventory_http",
        http_status:
          provider.status,
        preview:
          provider.preview,
        writes_performed:
          false,
        duration_ms:
          Date.now() - started
      });
    }


    const theaters =
      provider
        .data
        ?.data
        ?.theaterList
        ?.items;


    if (!Array.isArray(theaters)) {

      return respond({
        ok: false,
        graceful_failure: true,
        provider:
          "Cinemas NOS",
        stage:
          "theater_inventory_schema",
        message:
          "Expected data.theaterList.items array.",
        writes_performed:
          false,
        duration_ms:
          Date.now() - started
      });
    }


    /*
     * --------------------------------------
     * 2. SANITY CHECK
     * --------------------------------------
     *
     * We know NOS currently returns 29.
     *
     * Do NOT synchronize a suspiciously tiny
     * response. This protects us from marking
     * dozens of venues as apparently missing
     * because of a provider-side problem.
     *
     * 20 is deliberately conservative rather
     * than requiring exactly 29, because NOS
     * may legitimately add/remove cinemas.
     */

    if (theaters.length < 20) {

      return respond({
        ok: false,
        graceful_failure: true,
        provider:
          "Cinemas NOS",
        stage:
          "inventory_sanity_check",
        message:
          "NOS returned an unexpectedly small theater inventory.",
        theater_count:
          theaters.length,
        writes_performed:
          false,
        duration_ms:
          Date.now() - started
      });
    }


    /*
     * Every theater must have a provider ID.
     */

    const invalid =
      theaters.filter(
        theater =>
          !theater?.uuid ||
          !theater?.name
      );


    if (invalid.length) {

      return respond({
        ok: false,
        graceful_failure: true,
        provider:
          "Cinemas NOS",
        stage:
          "inventory_validation",
        message:
          "One or more NOS theaters lacked UUID or name.",
        invalid_count:
          invalid.length,
        writes_performed:
          false,
        duration_ms:
          Date.now() - started
      });
    }


    /*
     * Detect duplicate UUIDs before touching D1.
     */

    const uuidSet =
      new Set(
        theaters.map(
          theater =>
            theater.uuid
        )
      );


    if (
      uuidSet.size !==
      theaters.length
    ) {

      return respond({
        ok: false,
        graceful_failure: true,
        provider:
          "Cinemas NOS",
        stage:
          "duplicate_provider_ids",
        message:
          "NOS returned duplicate theater UUIDs.",
        theater_count:
          theaters.length,
        unique_uuid_count:
          uuidSet.size,
        writes_performed:
          false,
        duration_ms:
          Date.now() - started
      });
    }


    /*
     * --------------------------------------
     * 3. LOAD EXISTING NOS PLACE LINKS
     * --------------------------------------
     */

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


    const existingByUuid =
      new Map(
        existing.map(
          row => [
            row.external_id,
            row
          ]
        )
      );


    /*
     * --------------------------------------
     * 4. SYNCHRONIZE
     * --------------------------------------
     */

    const created = [];
    const updated = [];
    const unresolved = [];


    for (const theater of theaters) {

      const uuid =
        theater.uuid;

      const name =
        theater.name;

      const address =
        theater
          ?.address
          ?.plaintext ||
        null;

      const coordinates =
        parseLocation(
          theater.location
        );

      const city =
        inferCity(theater);

      const existingLink =
        existingByUuid.get(uuid);


      if (!city) {

        unresolved.push({
          uuid,
          name,
          issue:
            "city_not_resolved",
          address
        });
      }


      /*
       * Existing provider identity:
       * update the same PTLife place.
       */

      if (existingLink) {

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
          name,
          city,
          address,
          coordinates.latitude,
          coordinates.longitude,
          NOS_ORIGIN + "/",
          existingLink.place_id
        )
        .run();


        await db.prepare(`
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
        .run();


        updated.push({
          place_id:
            existingLink.place_id,
          uuid,
          name
        });

        continue;
      }


      /*
       * ----------------------------------
       * New NOS UUID.
       *
       * Before creating a place, attempt
       * conservative slug reuse.
       * ----------------------------------
       */

      const baseSlug =
        slugify(name);


      const sameSlug =
        await db.prepare(`
          SELECT id, official_name
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

        /*
         * A matching slug is strong enough
         * for this controlled NOS import,
         * but report that reuse explicitly.
         */

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
          name,
          city,
          address,
          coordinates.latitude,
          coordinates.longitude,
          NOS_ORIGIN + "/",
          placeId
        )
        .run();
      }

      else {

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
              ?, 'cinema', ?, 'pt-PT',
              ?, 'PT', ?, ?, ?, ?,
              'active'
            )
          `)
          .bind(
            baseSlug,
            name,
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


      /*
       * UNIQUE(source_id, external_id)
       * protects us at database level.
       */

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
          ?, ?, ?, ?, 'active',
          CURRENT_TIMESTAMP
        )
      `)
      .bind(
        placeId,
        NOS_SOURCE_ID,
        uuid,
        NOS_ORIGIN + "/"
      )
      .run();


      created.push({
        place_id:
          placeId,
        uuid,
        name,
        reused_existing_place:
          reusedExistingPlace
      });
    }


    /*
     * --------------------------------------
     * 5. DETECT PREVIOUSLY KNOWN NOS
     *    THEATERS ABSENT TODAY
     * --------------------------------------
     *
     * IMPORTANT:
     * We only REPORT these.
     *
     * We do not close, retire or delete them.
     */

    const missing =
      existing
        .filter(
          row =>
            !uuidSet.has(
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


    /*
     * --------------------------------------
     * 6. RESULT
     * --------------------------------------
     */

    return respond({
      ok: true,

      provider:
        "Cinemas NOS",

      source_id:
        NOS_SOURCE_ID,

      synchronization: true,

      fetched_at:
        new Date().toISOString(),

      provider_fetch_ms:
        provider.duration_ms,

      duration_ms:
        Date.now() - started,

      inventory: {
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
          unresolved.length
      },

      created,

      updated,

      missing_from_current_inventory:
        missing,

      unresolved,

      safety: {
        missing_theaters_deleted:
          false,

        missing_theaters_closed:
          false,

        provider_identity:
          "source_id + external_id",

        minimum_inventory_required:
          20
      },

      next_step:
        "Inspect the synchronization result and verify the NOS place count in D1 before importing movie programs and occurrences."
    });


  } catch (error) {

    /*
     * Graceful response instead of raw 502.
     *
     * Later we'll route this through safeRun
     * so provider_health/system_errors are
     * updated automatically as well.
     */

    return respond({
      ok: false,

      graceful_failure: true,

      provider:
        "Cinemas NOS",

      source_id:
        NOS_SOURCE_ID,

      stage:
        "theater_synchronization",

      message:
        error?.message ||
        String(error),

      stack:
        error?.stack || null,

      duration_ms:
        Date.now() - started
    });
  }
}
