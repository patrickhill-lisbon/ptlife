-- PTLife scheduled job infrastructure
-- Migration 0001
--
-- scheduled_jobs defines work that may be executed by the PTLife scheduler.
-- job_runs records individual scheduler executions.
--
-- Creating these tables does NOT enable scheduled execution.

CREATE TABLE scheduled_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    job_key TEXT NOT NULL UNIQUE,
    job_type TEXT NOT NULL,

    scope_type TEXT NOT NULL DEFAULT 'global'
        CHECK (
            scope_type IN (
                'global',
                'country',
                'region',
                'locality',
                'place',
                'source'
            )
        ),

    scope_id TEXT,

    frequency_minutes INTEGER NOT NULL
        CHECK (frequency_minutes > 0),

    enabled INTEGER NOT NULL DEFAULT 0
        CHECK (enabled IN (0, 1)),

    next_run_at TEXT,

    last_attempt_at TEXT,
    last_success_at TEXT,
    last_failure_at TEXT,

    consecutive_failures INTEGER NOT NULL DEFAULT 0
        CHECK (consecutive_failures >= 0),

    config_json TEXT,
    notes TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_scheduled_jobs_due
    ON scheduled_jobs (
        enabled,
        next_run_at
    );


CREATE TABLE job_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    scheduled_job_id INTEGER NOT NULL,

    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,

    status TEXT NOT NULL
        CHECK (
            status IN (
                'running',
                'success',
                'failed',
                'skipped'
            )
        ),

    duration_ms INTEGER
        CHECK (duration_ms IS NULL OR duration_ms >= 0),

    item_count INTEGER
        CHECK (item_count IS NULL OR item_count >= 0),

    error_id TEXT,
    metadata_json TEXT,

    FOREIGN KEY (scheduled_job_id)
        REFERENCES scheduled_jobs(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_job_runs_job_started
    ON job_runs (
        scheduled_job_id,
        started_at
    );
