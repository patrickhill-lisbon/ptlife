/*
 * PTLife — Cinemas NOS Controlled Movie Import Test
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * PURPOSE
 * -------
 * Controlled end-to-end import of ONE NOS aggregate movie:
 *
 *   A Odisseia / The Odyssey
 *
 * This test:
 *   - fetches the NOS catalogue
 *   - groups catalogue variants by aggregateformatnumber
 *   - selects the configured aggregate movie
 *   - creates or updates ONE PTLife program
 *   - records the NOS aggregate ID in program_sources
 *   - fetches NOS sessions
 *   - maps NOS theater UUIDs to existing PTLife places
 *   - inserts/updates occurrences by NOS session UUID
 *
 * It does NOT import the rest of the catalogue.
 */

import {
  safeRun
} from "../lib/safe-run.js";


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


/*
 * A Odisseia / The Odyssey
 *
 * The diagnostic established that this aggregate ID
 * represents both its ordinary 2D and IMAX variants.
 */

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

  const started =
    Date.now();

  const response =
    await fetch(
      url,
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
    data =
      JSON.parse(text);
  } catch {

    const error =
      new Error(
        "NOS returned invalid JSON"
      );

    error.preview =
      text.slice(0, 1000);

    throw error;
  }


  return {
    data,
    status:
      response.status,

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


function getMovieTitle(variants) {

  for (const movie of variants) {

    const value =
      clean(movie?.aggregatetitle);

    if (value) {
      return value;
    }
  }


  for (const movie of variants) {

    const value =
      clean(movie?.title);

    if (value) {
      return value;
    }
  }


  return "Untitled NOS film";
}


function getOriginalTitle(variants) {

  for (const movie of variants) {

    const value =
      clean(movie?.originaltitle);

    if (value) {
      return value;
    }
  }


  return null;
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


function getClassification(variants) {

  for (const movie of variants) {

    const value =
      clean(movie?.classification);

    if (value) {
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


/*
 * Convert NOS operational date + time into a local
 * ISO-like datetime.
 *
 * We deliberately store Lisbon local wall time because
 * program_occurrences already stores timezone separately
 * as Europe/Lisbon.
 */

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


  /*
   * Handle the most common ISO date representation.
   */

  const dateMatch =
    date.match(
      /^(\d{4})-(\d{2})-(\d{2})/
    );


  if (!dateMatch) {
    return null;
  }


  const timeMatch =
    clock.match(
      /^(\d{1,2}):(\d{2})/
    );


  if (!timeMatch) {
    return null;
  }


  const hh =
    timeMatch[1]
      .padStart(2, "0");

  const mm =
    timeMatch[2];


  return (
    `${dateMatch[1]}-` +
    `${dateMatch[2]}-` +
    `${dateMatch[3]}T` +
    `${hh}:${mm}:00`
  );
}


async function runImport(db) {

  /*
   * -------------------------------------------------------
   * 1. FETCH CATALOGUE
   * -------------------------------------------------------
   */

  const catalogue =
    await fetchJson(
      MOVIES_URL
    );


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


  if (variants.length === 0) {

    throw new Error(
      "Configured NOS test movie is no longer in the current catalogue"
    );
  }


  const title =
    getMovieTitle(
      variants
    );

  const originalTitle =
    getOriginalTitle(
      variants
    );

  const runtime =
    getRuntime(
      variants
    );

  const classification =
    getClassification(
      variants
    );


  /*
   * -------------------------------------------------------
   * 2. FIND EXISTING PROGRAM BY PROVIDER ID
   * -------------------------------------------------------
   */

  const existingSource =
    await db
      .prepare(`
        SELECT
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


    await db
      .prepare(`
        UPDATE programs
        SET
          official_title = ?,
          status = 'scheduled',
          source_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(
        title,
        SOURCE_ID,
        programId
      )
      .run();


    await db
      .prepare(`
        UPDATE program_sources
        SET
          last_verified_at =
            CURRENT_TIMESTAMP,
          status = 'active',
          updated_at =
            CURRENT_TIMESTAMP
        WHERE
          source_id = ?
          AND external_id = ?
      `)
      .bind(
        SOURCE_ID,
        TEST_AGGREGATE_ID
      )
      .run();

  } else {

    /*
     * We do not assign a single cinema to programs.place_id.
     * This movie can play at many NOS cinemas.
     */

    const inserted =
      await db
        .prepare(`
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


    const representative =
      variants[0];


    await db
      .prepare(`
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
          ?, ?, ?, ?, 'primary',
          CURRENT_TIMESTAMP,
          'active'
        )
      `)
      .bind(
        programId,
        SOURCE_ID,
        TEST_AGGREGATE_ID,
        absoluteNosUrl(
          representative?.detailurl
        )
      )
      .run();
  }


  /*
   * -------------------------------------------------------
   * 3. PROGRAM DETAILS
   * -------------------------------------------------------
   */

  const details =
    await db
      .prepare(`
        SELECT id
        FROM program_details
        WHERE program_id = ?
        LIMIT 1
      `)
      .bind(
        programId
      )
      .first();


  if (details) {

    await db
      .prepare(`
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

    await db
      .prepare(`
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


  /*
   * -------------------------------------------------------
   * 4. FETCH AGGREGATED NOS SESSIONS
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


  const days =
    Array.isArray(
      sessionFetch.data?.days
    )
      ? sessionFetch.data.days
      : [];


  if (days.length === 0) {

    throw new Error(
      "NOS returned no session days for the test movie"
    );
  }


  /*
   * -------------------------------------------------------
   * 5. LOAD NOS THEATER → PTLIFE PLACE MAP
   * -------------------------------------------------------
   */

  const theaterRows =
    await db
      .prepare(`
        SELECT
          place_id,
          external_id
        FROM place_sources
        WHERE
          source_id = ?
          AND external_id IS NOT NULL
          AND status = 'active'
      `)
      .bind(
        SOURCE_ID
      )
      .all();


  const theaterMap =
    new Map();


  for (
    const row
    of theaterRows.results || []
  ) {

    theaterMap.set(
      String(row.external_id),
      row.place_id
    );
  }


  /*
   * -------------------------------------------------------
   * 6. FLATTEN SESSIONS
   * -------------------------------------------------------
   */

  const incoming =
    [];

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

        const sessionUuid =
          clean(session?.uuid);


        if (!sessionUuid) {

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


        /*
         * Do not write an occurrence if we cannot
         * confidently identify its cinema.
         */

        if (!placeId) {
          continue;
        }


        incoming.push({
          externalId:
            sessionUuid,

          placeId,

          startsAt,

          format:
            clean(
              session?.format
            ),

          version:
            clean(
              session?.version
            ),

          type:
            clean(
              session?.type
            ),

          description:
            clean(
              session?.description
            )
        });
      }
    }
  }


  if (incoming.length === 0) {

    throw new Error(
      "NOS sessions were returned but no importable occurrences could be constructed"
    );
  }


  /*
   * -------------------------------------------------------
   * 7. UPSERT OCCURRENCES
   * -------------------------------------------------------
   *
   * Database unique index:
   *
   *   source_id + external_id
   *
   * guarantees idempotency.
   */

  let occurrencesCreated = 0;
  let occurrencesUpdated = 0;


  for (const item of incoming) {

    const existing =
      await db
        .prepare(`
          SELECT id
          FROM program_occurrences
          WHERE
            source_id = ?
            AND external_id = ?
          LIMIT 1
        `)
        .bind(
          SOURCE_ID,
          item.externalId
        )
        .first();


    if (existing) {

      await db
        .prepare(`
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
          existing.id
        )
        .run();


      occurrencesUpdated++;

    } else {

      await db
        .prepare(`
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
        .run();


      occurrencesCreated++;
    }
  }


  /*
   * -------------------------------------------------------
   * RESULT
   * -------------------------------------------------------
   */

  return {
    controlled_import:
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

      importable:
        incoming.length,

      created:
        occurrencesCreated,

      updated:
        occurrencesUpdated,

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

    timing: {
      catalogue_fetch_ms:
        catalogue.durationMs,

      sessions_fetch_ms:
        sessionFetch.durationMs
    },

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
        "controlled_movie_import",

      stage:
        "nos_movie_import",

      request:
        context.request,

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
              ?.importable <= 0
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
            ?.importable ?? 0,

      getMetadata:
        result => ({
          program_id:
            result.program.id,

          aggregate_movie_id:
            TEST_AGGREGATE_ID,

          variants:
            result.catalogue
              .matching_variants,

          occurrences:
            result.sessions
              .importable
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
            "Inspect the program and occurrences in D1, " +
            "then run this endpoint a second time to verify idempotency."
          )
        : (
            "Inspect the logged system_error before proceeding."
          )
  });
}
