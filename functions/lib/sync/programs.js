/*
 * PTLife — Generic Program Synchronizer
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * Synchronizes normalized provider programs into:
 *
 *   programs
 *   program_details
 *   program_sources
 *
 * It deliberately does NOT synchronize occurrences.
 *
 * Required normalized provider shape:
 *
 * {
 *   externalId,
 *   title,
 *   originalTitle,
 *   runtimeMinutes,
 *   contentRating,
 *   originalLanguage,
 *   sourceUrl
 * }
 *
 * Identity:
 *
 *   source_id + external_id
 *
 * Safety:
 *
 *   - never deletes programs
 *   - never retires missing programs
 *   - requires stable external IDs
 *   - existing provider identity always wins
 */


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


function integerOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number.parseInt(value, 10);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}


function requireSourceId(sourceId) {
  const value =
    Number(sourceId);

  if (
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(
      "Program synchronization requires a valid sourceId"
    );
  }

  return value;
}


function validateCandidate(candidate) {
  if (
    !candidate ||
    typeof candidate !== "object"
  ) {
    throw new Error(
      "Invalid normalized program candidate"
    );
  }

  const externalId =
    clean(candidate.externalId);

  const title =
    clean(candidate.title);

  if (!externalId) {
    throw new Error(
      "Normalized program is missing externalId"
    );
  }

  if (!title) {
    throw new Error(
      `Normalized program ${externalId} is missing title`
    );
  }

  return {
    externalId,
    title,

    originalTitle:
      clean(
        candidate.originalTitle
      ),

    runtimeMinutes:
      integerOrNull(
        candidate.runtimeMinutes
      ),

    contentRating:
      clean(
        candidate.contentRating
      ),

    originalLanguage:
      clean(
        candidate.originalLanguage
      ) ||
      "pt-PT",

    sourceUrl:
      clean(
        candidate.sourceUrl
      )
  };
}


function sameValue(a, b) {
  return (
    (a ?? null) ===
    (b ?? null)
  );
}


/*
 * Load all existing identities for one provider.
 *
 * We intentionally identify provider programs through
 * program_sources rather than by title.
 */

async function loadExistingPrograms(
  db,
  sourceId
) {
  const result =
    await db
      .prepare(`
        SELECT
          ps.external_id,
          ps.source_url,

          p.id AS program_id,
          p.official_title,
          p.original_language,
          p.status,

          pd.original_work_title,
          pd.runtime_minutes,
          pd.content_rating

        FROM program_sources ps

        JOIN programs p
          ON p.id = ps.program_id

        LEFT JOIN program_details pd
          ON pd.program_id = p.id

        WHERE
          ps.source_id = ?
          AND ps.external_id IS NOT NULL
      `)
      .bind(sourceId)
      .all();


  const map =
    new Map();


  for (
    const row
    of result.results || []
  ) {
    map.set(
      String(row.external_id),
      row
    );
  }


  return map;
}


/*
 * Create one new PTLife program.
 *
 * D1 does not give us a cross-statement transaction
 * primitive here, so we keep each operation simple and
 * deterministic. program_sources is the authoritative
 * provider identity.
 */

async function createProgram(
  db,
  sourceId,
  candidate
) {
  const created =
    await db
      .prepare(`
        INSERT INTO programs (
          program_type,
          official_title,
          original_language,
          status,
          source_id,
          created_at,
          updated_at
        )
        VALUES (
          'film',
          ?,
          ?,
          'scheduled',
          ?,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        RETURNING id
      `)
      .bind(
        candidate.title,
        candidate.originalLanguage,
        sourceId
      )
      .first();


  if (!created?.id) {
    throw new Error(
      `Failed to create program ${candidate.externalId}`
    );
  }


  const programId =
    created.id;


  await db
    .prepare(`
      INSERT INTO program_details (
        program_id,
        original_work_title,
        runtime_minutes,
        content_rating,
        source_id,
        created_at,
        updated_at
      )
      VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `)
    .bind(
      programId,
      candidate.originalTitle,
      candidate.runtimeMinutes,
      candidate.contentRating,
      sourceId
    )
    .run();


  await db
    .prepare(`
      INSERT INTO program_sources (
        program_id,
        source_id,
        external_id,
        source_url,
        role,
        last_verified_at,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ?,
        ?,
        ?,
        ?,
        'primary',
        CURRENT_TIMESTAMP,
        'active',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `)
    .bind(
      programId,
      sourceId,
      candidate.externalId,
      candidate.sourceUrl
    )
    .run();


  return programId;
}


/*
 * Update only when normalized content actually changed.
 *
 * last_verified_at is refreshed separately because a
 * successful provider observation is useful even when
 * the program itself is unchanged.
 */

async function updateProgram(
  db,
  sourceId,
  existing,
  candidate
) {
  const programChanged =
    !sameValue(
      existing.official_title,
      candidate.title
    ) ||
    !sameValue(
      existing.original_language,
      candidate.originalLanguage
    );


  const detailsChanged =
    !sameValue(
      existing.original_work_title,
      candidate.originalTitle
    ) ||
    !sameValue(
      existing.runtime_minutes,
      candidate.runtimeMinutes
    ) ||
    !sameValue(
      existing.content_rating,
      candidate.contentRating
    );


  const sourceChanged =
    !sameValue(
      existing.source_url,
      candidate.sourceUrl
    );


  if (programChanged) {
    await db
      .prepare(`
        UPDATE programs
        SET
          official_title = ?,
          original_language = ?,
          source_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(
        candidate.title,
        candidate.originalLanguage,
        sourceId,
        existing.program_id
      )
      .run();
  }


  if (detailsChanged) {
    await db
      .prepare(`
        INSERT INTO program_details (
          program_id,
          original_work_title,
          runtime_minutes,
          content_rating,
          source_id,
          created_at,
          updated_at
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )

        ON CONFLICT(program_id)
        DO UPDATE SET
          original_work_title =
            excluded.original_work_title,

          runtime_minutes =
            excluded.runtime_minutes,

          content_rating =
            excluded.content_rating,

          source_id =
            excluded.source_id,

          updated_at =
            CURRENT_TIMESTAMP
      `)
      .bind(
        existing.program_id,
        candidate.originalTitle,
        candidate.runtimeMinutes,
        candidate.contentRating,
        sourceId
      )
      .run();
  }


  /*
   * Always mark the provider identity as observed.
   */

  await db
    .prepare(`
      UPDATE program_sources
      SET
        source_url = ?,
        last_verified_at =
          CURRENT_TIMESTAMP,
        status = 'active',
        updated_at =
          CASE
            WHEN
              COALESCE(source_url, '') <>
              COALESCE(?, '')
            THEN CURRENT_TIMESTAMP
            ELSE updated_at
          END
      WHERE
        program_id = ?
        AND source_id = ?
        AND external_id = ?
    `)
    .bind(
      candidate.sourceUrl,
      candidate.sourceUrl,
      existing.program_id,
      sourceId,
      candidate.externalId
    )
    .run();


  return {
    changed:
      programChanged ||
      detailsChanged ||
      sourceChanged,

    programChanged,
    detailsChanged,
    sourceChanged
  };
}


/*
 * ---------------------------------------------------------
 * PUBLIC SYNCHRONIZER
 * ---------------------------------------------------------
 */

export async function syncPrograms({
  db,
  sourceId,
  programs
}) {
  if (!db) {
    throw new Error(
      "syncPrograms requires a D1 database binding"
    );
  }


  const validSourceId =
    requireSourceId(
      sourceId
    );


  if (!Array.isArray(programs)) {
    throw new Error(
      "syncPrograms requires a programs array"
    );
  }


  /*
   * Validate the entire incoming collection BEFORE any
   * writes occur.
   */

  const normalized =
    programs.map(
      validateCandidate
    );


  /*
   * Detect duplicate provider identities before writes.
   */

  const incomingIds =
    new Set();


  for (const candidate of normalized) {
    if (
      incomingIds.has(
        candidate.externalId
      )
    ) {
      throw new Error(
        "Duplicate normalized program externalId: " +
        candidate.externalId
      );
    }

    incomingIds.add(
      candidate.externalId
    );
  }


  const existing =
    await loadExistingPrograms(
      db,
      validSourceId
    );


  const result = {
    incoming:
      normalized.length,

    previouslyStored:
      existing.size,

    created: 0,

    updated: 0,

    unchanged: 0,

    createdPrograms: [],

    updatedPrograms: [],

    safety: {
      programsDeleted:
        false,

      missingProgramsRetired:
        false,

      identity:
        "source_id + external_id"
    }
  };


  for (const candidate of normalized) {
    const stored =
      existing.get(
        candidate.externalId
      );


    if (!stored) {
      const programId =
        await createProgram(
          db,
          validSourceId,
          candidate
        );


      result.created++;


      result.createdPrograms.push({
        programId,
        externalId:
          candidate.externalId,

        title:
          candidate.title
      });


      continue;
    }


    const update =
      await updateProgram(
        db,
        validSourceId,
        stored,
        candidate
      );


    if (update.changed) {
      result.updated++;


      result.updatedPrograms.push({
        programId:
          stored.program_id,

        externalId:
          candidate.externalId,

        title:
          candidate.title,

        programChanged:
          update.programChanged,

        detailsChanged:
          update.detailsChanged,

        sourceChanged:
          update.sourceChanged
      });

    } else {
      result.unchanged++;
    }
  }


  return result;
}
