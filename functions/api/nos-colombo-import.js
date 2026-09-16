/*
 * PTLife — NOS Colombo Controlled Import v1
 *
 * Purpose:
 *   Import exactly ONE known NOS cinema into PTLife:
 *   Cinemas NOS Colombo.
 *
 * This is intentionally NOT the full NOS importer.
 *
 * Safe to run repeatedly:
 *   - finds the cinema using place_sources
 *   - creates it if missing
 *   - otherwise updates the existing place
 *   - does not create duplicate place_sources
 */

const NOS_SOURCE_ID = 8;

const COLOMBO = {
  external_id:
    "e0ea3044-4a1b-46b1-bca2-69fd8eae16d7",

  slug:
    "cinemas-nos-colombo",

  official_name:
    "Cinemas NOS Colombo",

  original_language:
    "pt-PT",

  place_type:
    "cinema",

  city:
    "Lisboa",

  country_code:
    "PT",

  address:
    "Edifício Colombo, loja A203. Av. Lusiada Lisboa",

  latitude:
    38.755174,

  longitude:
    -9.187056,

  official_website:
    "https://www.cinemas.nos.pt/",

  status:
    "active"
};


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


export async function onRequestGet(context) {
  const db = context.env.DB;
  const started = Date.now();

  try {

    /*
     * -----------------------------------------
     * STEP 1 — LOOK FOR EXISTING PROVIDER LINK
     * -----------------------------------------
     */

    const existingLink =
      await db.prepare(`
        SELECT
          ps.id AS place_source_id,
          ps.place_id,
          p.official_name,
          p.slug
        FROM place_sources ps
        JOIN places p
          ON p.id = ps.place_id
        WHERE ps.source_id = ?
          AND ps.external_id = ?
        LIMIT 1
      `)
      .bind(
        NOS_SOURCE_ID,
        COLOMBO.external_id
      )
      .first();


    let placeId;
    let action;


    /*
     * -----------------------------------------
     * STEP 2 — UPDATE IF ALREADY KNOWN
     * -----------------------------------------
     */

    if (existingLink) {

      placeId =
        existingLink.place_id;

      await db.prepare(`
        UPDATE places
        SET
          official_name = ?,
          original_language = ?,
          place_type = ?,
          city = ?,
          country_code = ?,
          address = ?,
          latitude = ?,
          longitude = ?,
          official_website = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(
        COLOMBO.official_name,
        COLOMBO.original_language,
        COLOMBO.place_type,
        COLOMBO.city,
        COLOMBO.country_code,
        COLOMBO.address,
        COLOMBO.latitude,
        COLOMBO.longitude,
        COLOMBO.official_website,
        COLOMBO.status,
        placeId
      )
      .run();


      await db.prepare(`
        UPDATE place_sources
        SET
          status = 'active',
          last_verified_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE source_id = ?
          AND external_id = ?
      `)
      .bind(
        NOS_SOURCE_ID,
        COLOMBO.external_id
      )
      .run();


      action = "updated";
    }


    /*
     * -----------------------------------------
     * STEP 3 — CREATE IF NOT KNOWN
     * -----------------------------------------
     */

    else {

      /*
       * Before inserting, also check the slug.
       *
       * This protects us if Colombo was manually
       * created previously but never linked to NOS.
       */

      const existingPlace =
        await db.prepare(`
          SELECT id
          FROM places
          WHERE slug = ?
          LIMIT 1
        `)
        .bind(COLOMBO.slug)
        .first();


      if (existingPlace) {

        placeId =
          existingPlace.id;

        action =
          "linked_existing_place";


        await db.prepare(`
          UPDATE places
          SET
            official_name = ?,
            original_language = ?,
            place_type = ?,
            city = ?,
            country_code = ?,
            address = ?,
            latitude = ?,
            longitude = ?,
            official_website = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .bind(
          COLOMBO.official_name,
          COLOMBO.original_language,
          COLOMBO.place_type,
          COLOMBO.city,
          COLOMBO.country_code,
          COLOMBO.address,
          COLOMBO.latitude,
          COLOMBO.longitude,
          COLOMBO.official_website,
          COLOMBO.status,
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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .bind(
            COLOMBO.slug,
            COLOMBO.place_type,
            COLOMBO.official_name,
            COLOMBO.original_language,
            COLOMBO.city,
            COLOMBO.country_code,
            COLOMBO.address,
            COLOMBO.latitude,
            COLOMBO.longitude,
            COLOMBO.official_website,
            COLOMBO.status
          )
          .run();


        placeId =
          insert.meta.last_row_id;

        action = "created";
      }


      /*
       * Link PTLife place to NOS identity.
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
        VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)
      `)
      .bind(
        placeId,
        NOS_SOURCE_ID,
        COLOMBO.external_id,
        COLOMBO.official_website
      )
      .run();
    }


    /*
     * -----------------------------------------
     * STEP 4 — READ BACK WHAT WE SAVED
     * -----------------------------------------
     */

    const saved =
      await db.prepare(`
        SELECT
          p.id AS place_id,
          p.slug,
          p.place_type,
          p.official_name,
          p.city,
          p.country_code,
          p.address,
          p.latitude,
          p.longitude,
          p.official_website,
          p.status,

          ps.id AS place_source_id,
          ps.source_id,
          ps.external_id,
          ps.status AS source_status,
          ps.last_verified_at

        FROM places p

        JOIN place_sources ps
          ON ps.place_id = p.id

        WHERE ps.source_id = ?
          AND ps.external_id = ?

        LIMIT 1
      `)
      .bind(
        NOS_SOURCE_ID,
        COLOMBO.external_id
      )
      .first();


    return respond({
      ok: true,

      controlled_import: true,

      provider:
        "Cinemas NOS",

      source_id:
        NOS_SOURCE_ID,

      action,

      place_id:
        placeId,

      saved,

      duration_ms:
        Date.now() - started,

      next_step:
        "Inspect this record before enabling the full 29-theater NOS importer."
    });

  } catch (error) {

    /*
     * Do NOT expose a Cloudflare 502.
     */

    return respond({
      ok: false,

      graceful_failure: true,

      controlled_import: true,

      provider:
        "Cinemas NOS",

      stage:
        "colombo_import",

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
