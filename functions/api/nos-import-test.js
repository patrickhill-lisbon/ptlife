/*
 * PTLife — Cinemas NOS Controlled Movie Import Test v2
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * PURPOSE
 * -------
 * Controlled import of ONE NOS aggregate movie.
 *
 * Performance design:
 *   - fetch catalogue once
 *   - fetch sessions once
 *   - load NOS theater mappings once
 *   - load existing occurrences once
 *   - compare everything in memory
 *   - batch only necessary INSERTs/UPDATEs
 *   - do not write unchanged occurrences
 */

import { safeRun } from "../lib/safe-run.js";

const SOURCE_ID = 8;

const NOS_ORIGIN =
  "https://www.cinemas.nos.pt";

const MOVIES_URL =
  NOS_ORIGIN +
  "/graphql/execute.json/cinemas/getMoviesInTheaters";

const SESSIONS_BASE =
  NOS_ORIGIN +
  "/bin/cinemas/render/" +
  "getMovieSessions.getMovieSessionsAggregator.json";

const TEST_AGGREGATE_ID =
  "1e70190b-5cf3-4937-b361-24f67bdd11d0";


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


async function fetchJson(url) {

  const started = Date.now();

  const response =
    await fetch(url, {
      headers: {
        accept: "application/json"
      }
    });

  const text =
    await response.text();

  if (!response.ok) {
    const error =
      new Error(
        `NOS HTTP ${response.status}`
      );

    error.httpStatus =
      response.status;

    error.preview =
      text.slice(0, 1000);

    throw error;
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "NOS returned invalid JSON"
    );
  }

  return {
    data,
    status: response.status,
    durationMs:
      Date.now() - started
  };
}


function findMovies(data) {

  const candidates = [
    data?.data?.movieList?.items,
    data?.data?.moviesList?.items,
    data?.data?.movies?.items,
    data?.movieList?.items,
    data?.movies?.items
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "NOS movie catalogue array not found"
  );
}


function clean(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const result =
    String(value).trim();

  return result || null;
}


function getAggregateId(movie) {
  return clean(
    movie?.aggregateformatnumber
  );
}


function firstValue(
  variants,
  field
) {

  for (const movie of variants) {

    const value =
      clean(movie?.[field]);

    if (value) {
      return value;
    }
  }

  return null;
}


function getTitle(variants) {

  return (
    firstValue(
      variants,
      "aggregatetitle"
    ) ||
    firstValue(
      variants,
      "title"
    ) ||
    "Untitled NOS film"
  );
}


function getRuntime(variants) {

  for (const movie of variants) {

    const value =
      Number.parseInt(
        movie?.duration,
        10
      );

    if (
      Number.isFinite(value) &&
      value > 0
    ) {
      return value;
    }
  }

  return null;
}


function absoluteNosUrl(path) {

  if (!path) {
    return NOS_ORIGIN + "/";
  }

  try {
    return new URL(
      path,
      NOS_ORIGIN
    ).toString();
  } catch {
    return NOS_ORIGIN + "/";
  }
}


function buildStartsAt(
  operationalDate,
  time
) {

  const date =
    clean(operationalDate);

  const clock =
    clean(time);

  if (!date || !clock) {
    return null;
  }

  const dateMatch =
    date.match(
      /^(\d{4})-(\d{2})-(\d{2})/
    );

  const timeMatch =
    clock.match(
      /^(\d{1,2}):(\d{2})/
    );

  if (
    !dateMatch ||
    !timeMatch
  ) {
    return null;
  }

  const hh =
    timeMatch[1]
      .padStart(2, "0");

  return (
    `${dateMatch[1]}-` +
    `${dateMatch[2]}-` +
    `${dateMatch[3]}T` +
    `${hh}:` +
    `${timeMatch[2]}:00`
  );
}


/*
 * D1 batch helper.
 *
 * Keeping batches reasonably sized prevents a future
 * full-catalogue importer from creating giant batches.
 */

async function runBatches(
  db,
  statements,
  size = 100
) {

  if (!statements.length) {
    return;
  }

  for (
    let i = 0;
    i < statements.length;
    i += size
  ) {

    await db.batch(
      statements.slice(
        i,
        i + size
      )
    );
  }
}


async function runImport(db) {

  const timing = {};

  /*
   * -------------------------------------------------------
   * 1. CATALOGUE
   * -------------------------------------------------------
   */

  const catalogue =
    await fetchJson(
      MOVIES_URL
    );

  timing.catalogue_fetch_ms =
    catalogue.durationMs;


  const movies =
    findMovies(
      catalogue.data
    );


  const variants =
    movies.filter(
      movie =>
        getAggregateId(movie) ===
        TEST_AGGREGATE_ID
    );


  if (!variants.length) {
    throw new Error(
      "Configured NOS test movie is no longer in the current catalogue"
    );
  }


  const title =
    getTitle(variants);

  const originalTitle =
    firstValue(
      variants,
      "originaltitle"
    );

  const classification =
    firstValue(
      variants,
      "classification"
    );

  const runtime =
    getRuntime(
      variants
    );


  /*
   * -------------------------------------------------------
   * 2. PROGRAM
   * -------------------------------------------------------
   */

  const programStarted =
    Date.now();


  const existingSource =
    await db.prepare(`
      SELECT
        ps.id AS program_source_id,
        ps.program_id
      FROM program_sources ps
      WHERE
        ps.source_id = ?
        AND ps.external_id = ?
      LIMIT 1
    `)
    .bind(
      SOURCE_ID,
      TEST_AGGREGATE_ID
    )
    .first();


  let programId;
  let programAction;


  if (existingSource) {

    programId =
      existingSource.program_id;

    programAction =
      "updated";


    await db.batch([

      db.prepare(`
        UPDATE programs
        SET
          official_title = ?,
          status = 'scheduled',
          source_id = ?,
          updated_at =
            CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(
        title,
        SOURCE_ID,
        programId
      ),

      db.prepare(`
        UPDATE program_sources
        SET
          last_verified_at =
            CURRENT_TIMESTAMP,
          status = 'active',
          updated_at =
            CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(
        existingSource
          .program_source_id
      )

    ]);

  } else {

    const inserted =
      await db.prepare(`
        INSERT INTO programs (
          place_id,
          program_type,
          official_title,
          original_language,
          status,
          source_id
        )
        VALUES (
          NULL,
          'film',
          ?,
          'pt-PT',
          'scheduled',
          ?
        )
        RETURNING id
      `)
      .bind(
        title,
        SOURCE_ID
      )
      .first();


    if (!inserted?.id) {
      throw new Error(
        "Failed to create PTLife program"
      );
    }


    programId =
      inserted.id;

    programAction =
      "created";


    await db.prepare(`
      INSERT INTO program_sources (
        program_id,
        source_id,
        external_id,
        source_url,
        role,
        last_verified_at,
        status
      )
      VALUES (
        ?, ?, ?, ?,
        'primary',
        CURRENT_TIMESTAMP,
        'active'
      )
    `)
    .bind(
      programId,
      SOURCE_ID,
      TEST_AGGREGATE_ID,
      absoluteNosUrl(
        variants[0]?.detailurl
      )
    )
    .run();
  }


  /*
   * Program details.
   */

  const details =
    await db.prepare(`
      SELECT id
      FROM program_details
      WHERE program_id = ?
      LIMIT 1
    `)
    .bind(programId)
    .first();


  if (details) {

    await db.prepare(`
      UPDATE program_details
      SET
        original_work_title = ?,
        work_type = 'film',
        runtime_minutes = ?,
        content_rating = ?,
        source_id = ?,
        updated_at =
          CURRENT_TIMESTAMP
      WHERE program_id = ?
    `)
    .bind(
      originalTitle,
      runtime,
      classification,
      SOURCE_ID,
      programId
    )
    .run();

  } else {

    await db.prepare(`
      INSERT INTO program_details (
        program_id,
        original_work_title,
        work_type,
        runtime_minutes,
        content_rating,
        source_id
      )
      VALUES (
        ?, ?, 'film', ?, ?, ?
      )
    `)
    .bind(
      programId,
      originalTitle,
      runtime,
      classification,
      SOURCE_ID
    )
    .run();
  }


  timing.program_ms =
    Date.now() -
    programStarted;


  /*
   * -------------------------------------------------------
   * 3. SESSIONS
   * -------------------------------------------------------
   */

  const sessionsUrl =
    SESSIONS_BASE +
    "?aggregateMovieId=" +
    encodeURIComponent(
      TEST_AGGREGATE_ID
    );


  const sessionFetch =
    await fetchJson(
      sessionsUrl
    );


  timing.sessions_fetch_ms =
    sessionFetch.durationMs;


  const days =
    Array.isArray(
      sessionFetch.data?.days
    )
      ? sessionFetch.data.days
      : [];


  if (!days.length) {
    throw new Error(
      "NOS returned no session days for the test movie"
    );
  }


  /*
   * -------------------------------------------------------
   * 4. LOAD ALL THEATER MAPPINGS ONCE
   * -------------------------------------------------------
   */

  const mappingStarted =
    Date.now();


  const theaterRows =
    await db.prepare(`
      SELECT
        place_id,
        external_id
      FROM place_sources
      WHERE
        source_id = ?
        AND external_id IS NOT NULL
        AND status = 'active'
    `)
    .bind(SOURCE_ID)
    .all();


  const theaterMap =
    new Map(
      (theaterRows.results || [])
        .map(
          row => [
            String(
              row.external_id
            ),
            row.place_id
          ]
        )
    );


  timing.theater_mapping_ms =
    Date.now() -
    mappingStarted;


  /*
   * -------------------------------------------------------
   * 5. FLATTEN NOS SESSIONS
   * -------------------------------------------------------
   */

  const incoming = [];

  const unresolvedTheaters =
    new Map();

  let sessionsWithoutUuid = 0;
  let sessionsWithoutDate = 0;


  for (const day of days) {

    const theaters =
      Array.isArray(day?.theaters)
        ? day.theaters
        : [];


    for (const theater of theaters) {

      const theaterUuid =
        clean(
          theater?.theaterId ??
          theater?.theaterID
        );


      const placeId =
        theaterUuid
          ? theaterMap.get(
              theaterUuid
            )
          : null;


      if (
        theaterUuid &&
        !placeId
      ) {
        unresolvedTheaters.set(
          theaterUuid,
          clean(theater?.name)
        );
      }


      const sessions =
        Array.isArray(
          theater?.sessions
        )
          ? theater.sessions
          : [];


      for (const session of sessions) {

        const externalId =
          clean(session?.uuid);


        if (!externalId) {
          sessionsWithoutUuid++;
          continue;
        }


        const startsAt =
          buildStartsAt(
            session?.operationalDate,
            session?.time
          );


        if (!startsAt) {
          sessionsWithoutDate++;
          continue;
        }


        if (!placeId) {
          continue;
        }


        incoming.push({
          externalId,
          placeId,
          startsAt,

          format:
            clean(session?.format),

          version:
            clean(session?.version),

          type:
            clean(session?.type),

          description:
            clean(
              session?.description
            )
        });
      }
    }
  }


  if (!incoming.length) {
    throw new Error(
      "NOS returned no importable occurrences"
    );
  }


  /*
   * Defensive check: provider should not send the
   * same session UUID twice.
   */

  const incomingIds =
    new Set();


  for (const item of incoming) {

    if (
      incomingIds.has(
        item.externalId
      )
    ) {
      throw new Error(
        "NOS returned duplicate session UUID: " +
        item.externalId
      );
    }

    incomingIds.add(
      item.externalId
    );
  }


  /*
   * -------------------------------------------------------
   * 6. LOAD EXISTING OCCURRENCES ONCE
   * -------------------------------------------------------
   *
   * We deliberately limit this to the current program.
   */

  const existingStarted =
    Date.now();


  const existingRows =
    await db.prepare(`
      SELECT
        id,
        program_id,
        place_id,
        starts_at,
        status,
        external_id
      FROM program_occurrences
      WHERE
        source_id = ?
        AND program_id = ?
        AND external_id IS NOT NULL
    `)
    .bind(
      SOURCE_ID,
      programId
    )
    .all();


  timing.existing_occurrences_read_ms =
    Date.now() -
    existingStarted;


  const existingById =
    new Map(
      (existingRows.results || [])
        .map(
          row => [
            String(
              row.external_id
            ),
            row
          ]
        )
    );


  /*
   * -------------------------------------------------------
   * 7. COMPARE IN MEMORY
   * -------------------------------------------------------
   */

  const creates = [];
  const updates = [];
  const unchanged = [];


  for (const item of incoming) {

    const existing =
      existingById.get(
        item.externalId
      );


    if (!existing) {

      creates.push(item);

      continue;
    }


    const same =
      Number(existing.program_id) ===
        Number(programId) &&

      Number(existing.place_id) ===
        Number(item.placeId) &&

      String(existing.starts_at) ===
        String(item.startsAt) &&

      existing.status ===
        "scheduled";


    if (same) {
      unchanged.push(item);
    } else {
      updates.push({
        ...item,
        id:
          existing.id
      });
    }
  }


  /*
   * -------------------------------------------------------
   * 8. BATCH ONLY ACTUAL WRITES
   * -------------------------------------------------------
   */

  const writeStarted =
    Date.now();

  const statements = [];


  for (const item of creates) {

    statements.push(

      db.prepare(`
        INSERT INTO program_occurrences (
          program_id,
          starts_at,
          timezone,
          status,
          source_id,
          place_id,
          external_id
        )
        VALUES (
          ?,
          ?,
          'Europe/Lisbon',
          'scheduled',
          ?,
          ?,
          ?
        )
      `)
      .bind(
        programId,
        item.startsAt,
        SOURCE_ID,
        item.placeId,
        item.externalId
      )

    );
  }


  for (const item of updates) {

    statements.push(

      db.prepare(`
        UPDATE program_occurrences
        SET
          program_id = ?,
          place_id = ?,
          starts_at = ?,
          timezone =
            'Europe/Lisbon',
          status =
            'scheduled',
          updated_at =
            CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(
        programId,
        item.placeId,
        item.startsAt,
        item.id
      )

    );
  }


  await runBatches(
    db,
    statements,
    100
  );


  timing.occurrence_write_ms =
    Date.now() -
    writeStarted;


  /*
   * -------------------------------------------------------
   * RESULT
   * -------------------------------------------------------
   */

  return {

    controlled_import:
      true,

    optimized:
      true,

    source_id:
      SOURCE_ID,

    aggregate_movie_id:
      TEST_AGGREGATE_ID,


    catalogue: {

      rows:
        movies.length,

      matching_variants:
        variants.length,

      variants:
        variants.map(
          movie => ({
            uuid:
              clean(movie?.uuid),

            title:
              clean(movie?.title),

            format:
              clean(movie?.format),

            version:
              clean(movie?.version)
          })
        )
    },


    program: {

      id:
        programId,

      action:
        programAction,

      title,

      original_title:
        originalTitle,

      runtime_minutes:
        runtime,

      content_rating:
        classification
    },


    sessions: {

      days:
        days.length,

      incoming:
        incoming.length,

      previously_stored:
        existingById.size,

      created:
        creates.length,

      updated:
        updates.length,

      unchanged:
        unchanged.length,

      skipped_without_uuid:
        sessionsWithoutUuid,

      skipped_without_date:
        sessionsWithoutDate
    },


    unresolved_theaters:
      Array.from(
        unresolvedTheaters,
        ([uuid, name]) => ({
          uuid,
          name
        })
      ),


    timing,


    safety: {

      full_catalogue_imported:
        false,

      other_movies_written:
        false,

      occurrence_identity:
        "source_id + NOS session uuid",

      program_identity:
        "source_id + NOS aggregateformatnumber",

      unresolved_theaters_written:
        false,

      unchanged_occurrences_written:
        false
    }
  };
}


export async function onRequestGet(
  context
) {

  const started =
    Date.now();


  const result =
    await safeRun({

      db:
        context.env.DB,

      provider:
        "cinemas_nos",

      operation:
        "controlled_movie_import_v2",

      stage:
        "nos_movie_import",

      sourceFile:
        "functions/api/nos-import-test.js",

      request:
        context.request,

      reproduction:
        "GET /api/nos-import-test",

      context: {
        source_id:
          SOURCE_ID,

        aggregate_movie_id:
          TEST_AGGREGATE_ID
      },


      run:
        () =>
          runImport(
            context.env.DB
          ),


      validate:
        result => {

          if (!result?.program?.id) {
            throw new Error(
              "NOS importer did not produce a program ID"
            );
          }


          if (
            result.sessions
              ?.incoming <= 0
          ) {
            throw new Error(
              "NOS importer produced no occurrences"
            );
          }


          return true;
        },


      getItemCount:
        result =>
          result.sessions
            ?.incoming ?? 0,


      getMetadata:
        result => ({

          program_id:
            result.program.id,

          aggregate_movie_id:
            TEST_AGGREGATE_ID,

          incoming:
            result.sessions.incoming,

          created:
            result.sessions.created,

          updated:
            result.sessions.updated,

          unchanged:
            result.sessions.unchanged
        }),


      fallbackData: {
        program: null,
        sessions: {
          items: []
        }
      }
    });


  return respond({

    ...result,

    diagnostic_test:
      true,

    total_request_ms:
      Date.now() - started,

    next_step:
      result.ok
        ? (
            "Verify created=0, updated=0 and unchanged=442. " +
            "If so, controlled NOS movie import is idempotent."
          )
        : (
            "Inspect system_errors and provider_health before proceeding."
          )
  });
}
