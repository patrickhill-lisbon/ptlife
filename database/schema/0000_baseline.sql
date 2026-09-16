-- PTLife Database
-- Baseline Schema
--
-- This file defines the complete database structure required to
-- create a new PTLife database from scratch.
--
-- It represents the production schema as of 2026-09-16.
-- Reference/lookup data is maintained separately under database/seed/.
--
-- Do not use this file to upgrade an existing production database.
-- Changes after this baseline belong in database/migrations/.
--
-- Generated from the production D1 sqlite_master definitions captured
-- on 2026-09-16. Cloudflare's internal _cf_KV table is intentionally omitted.

PRAGMA foreign_keys = ON;

-- ============================================================
-- TABLES
-- ============================================================

-- action_dates
CREATE TABLE action_dates ( id INTEGER PRIMARY KEY AUTOINCREMENT, program_id INTEGER, occurrence_id INTEGER, action_type TEXT NOT NULL CHECK (action_type IN ( 'tickets_on_sale', 'registration_opens', 'registration_closes', 'booking_opens', 'booking_closes', 'early_bird_starts', 'early_bird_ends', 'application_opens', 'application_deadline', 'reservation_required_by', 'other' )), action_at TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Europe/Lisbon', action_url TEXT, status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ( 'scheduled', 'open', 'closed', 'cancelled', 'changed' )), source_id INTEGER, notes_original TEXT, notes_english TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, CHECK ( program_id IS NOT NULL OR occurrence_id IS NOT NULL ), FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE, FOREIGN KEY (occurrence_id) REFERENCES program_occurrences(id) ON DELETE CASCADE, FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL );

-- admission_conditions
CREATE TABLE admission_conditions ( id INTEGER PRIMARY KEY AUTOINCREMENT, admission_rule_id INTEGER NOT NULL, condition_type TEXT NOT NULL CHECK (condition_type IN ( 'age_min', 'age_max', 'resident_country', 'resident_city', 'student', 'membership', 'card', 'group_adults_min', 'group_adults_max', 'group_children_min', 'group_children_max', 'accompanied_child', 'other' )), operator TEXT NOT NULL DEFAULT 'equals' CHECK (operator IN ( 'equals', 'not_equals', 'greater_than_or_equal', 'less_than_or_equal', 'contains' )), value_text TEXT, value_number REAL, requirement_group INTEGER NOT NULL DEFAULT 1, source_id INTEGER, notes_original TEXT, notes_english TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (admission_rule_id) REFERENCES admission_rules(id) ON DELETE CASCADE, FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL );

-- admission_rules
CREATE TABLE admission_rules ( id INTEGER PRIMARY KEY AUTOINCREMENT, place_id INTEGER NOT NULL, rule_name_original TEXT, rule_name_english TEXT NOT NULL, price_cents INTEGER, currency TEXT NOT NULL DEFAULT 'EUR', pricing_type TEXT NOT NULL DEFAULT 'fixed' CHECK (pricing_type IN ( 'fixed', 'free', 'percentage_discount', 'amount_discount' )), discount_value REAL, min_age INTEGER, max_age INTEGER, residency_scope TEXT, student_required INTEGER NOT NULL DEFAULT 0 CHECK (student_required IN (0, 1)), proof_required INTEGER NOT NULL DEFAULT 0 CHECK (proof_required IN (0, 1)), proof_description_original TEXT, proof_description_english TEXT, valid_from TEXT, valid_until TEXT, source_id INTEGER, priority INTEGER NOT NULL DEFAULT 100, notes_original TEXT, notes_english TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE, FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL );

-- admission_time_rules
CREATE TABLE admission_time_rules ( id INTEGER PRIMARY KEY AUTOINCREMENT, admission_rule_id INTEGER NOT NULL, day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6), week_of_month INTEGER CHECK (week_of_month BETWEEN 1 AND 5), starts_at TEXT, ends_at TEXT, valid_from TEXT, valid_until TEXT, specific_date TEXT, source_id INTEGER, notes_original TEXT, notes_english TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (admission_rule_id) REFERENCES admission_rules(id) ON DELETE CASCADE, FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL );

-- categories
CREATE TABLE categories ( id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name_english TEXT NOT NULL, name_portuguese TEXT, description_english TEXT, sort_order INTEGER NOT NULL DEFAULT 100, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );

-- countries
CREATE TABLE countries ( id INTEGER PRIMARY KEY AUTOINCREMENT, country_code TEXT NOT NULL UNIQUE, name_english TEXT NOT NULL, native_name TEXT, default_language_code TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );

-- localities
CREATE TABLE localities ( id INTEGER PRIMARY KEY AUTOINCREMENT, parent_locality_id INTEGER, country_id INTEGER NOT NULL, locality_type TEXT NOT NULL CHECK ( locality_type IN ( 'region', 'metropolitan_area', 'city', 'town', 'village', 'district', 'borough', 'neighborhood', 'other' ) ), name TEXT NOT NULL, name_english TEXT, slug TEXT NOT NULL, latitude REAL, longitude REAL, timezone TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE CASCADE, FOREIGN KEY (parent_locality_id) REFERENCES localities(id) ON DELETE SET NULL, UNIQUE (country_id, parent_locality_id, slug) );

-- membership_benefits
CREATE TABLE membership_benefits ( id INTEGER PRIMARY KEY AUTOINCREMENT, membership_id INTEGER NOT NULL, benefit_type TEXT NOT NULL, value_number REAL, value_text TEXT, benefit_original TEXT, benefit_english TEXT, FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE CASCADE );

-- membership_conditions
CREATE TABLE membership_conditions ( id INTEGER PRIMARY KEY AUTOINCREMENT, membership_id INTEGER NOT NULL, condition_type TEXT NOT NULL, operator TEXT NOT NULL DEFAULT 'equals', value_text TEXT, value_number REAL, requirement_group INTEGER NOT NULL DEFAULT 1, notes_original TEXT, notes_english TEXT, FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE CASCADE );

-- membership_sources
CREATE TABLE membership_sources ( id INTEGER PRIMARY KEY AUTOINCREMENT, membership_id INTEGER NOT NULL, source_id INTEGER NOT NULL, last_verified_at TEXT, verification_status TEXT NOT NULL DEFAULT 'verified' CHECK ( verification_status IN ( 'verified', 'needs_review', 'outdated' ) ), FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE CASCADE, FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE, UNIQUE (membership_id, source_id) );

-- membership_translations
CREATE TABLE membership_translations ( id INTEGER PRIMARY KEY AUTOINCREMENT, membership_id INTEGER NOT NULL, language_code TEXT NOT NULL, display_name TEXT NOT NULL, short_description TEXT, full_description TEXT, translation_status TEXT NOT NULL DEFAULT 'translated' CHECK ( translation_status IN ( 'original', 'official', 'translated', 'machine', 'reviewed' ) ), FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE CASCADE, UNIQUE (membership_id, language_code) );

-- memberships
CREATE TABLE memberships ( id INTEGER PRIMARY KEY AUTOINCREMENT, place_id INTEGER NOT NULL, membership_name_original TEXT NOT NULL, original_language TEXT DEFAULT 'pt-PT', membership_type TEXT NOT NULL DEFAULT 'annual' CHECK ( membership_type IN ( 'annual', 'monthly', 'family', 'individual', 'student', 'senior', 'supporter', 'other' ) ), price_cents INTEGER, currency TEXT NOT NULL DEFAULT 'EUR', duration_days INTEGER, valid_from TEXT, valid_until TEXT, purchase_url TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK ( status IN ( 'active', 'future', 'expired', 'unavailable' ) ), notes_original TEXT, notes_english TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, duration_months INTEGER, FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE );

-- opening_hours
CREATE TABLE opening_hours ( id INTEGER PRIMARY KEY AUTOINCREMENT, place_id INTEGER NOT NULL, day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), opens_at TEXT, closes_at TEXT, is_closed INTEGER NOT NULL DEFAULT 0 CHECK (is_closed IN (0, 1)), valid_from TEXT, valid_until TEXT, source_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE, FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL );

-- place_aliases
CREATE TABLE place_aliases ( id INTEGER PRIMARY KEY AUTOINCREMENT, place_id INTEGER NOT NULL, alias TEXT NOT NULL, language_code TEXT, alias_type TEXT NOT NULL DEFAULT 'search' CHECK (alias_type IN ( 'official', 'translation', 'abbreviation', 'alternate', 'search' )), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, normalized_alias TEXT, FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE, UNIQUE (place_id, alias) );

-- place_categories
CREATE TABLE place_categories ( place_id INTEGER NOT NULL, category_id INTEGER NOT NULL, PRIMARY KEY (place_id, category_id), FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE, FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE );

-- place_relationships
CREATE TABLE place_relationships ( id INTEGER PRIMARY KEY AUTOINCREMENT, parent_place_id INTEGER NOT NULL, child_place_id INTEGER NOT NULL, relationship_type TEXT NOT NULL CHECK ( relationship_type IN ( 'located_inside', 'part_of', 'managed_by', 'campus_of', 'other' ) ), valid_from TEXT, valid_until TEXT, source_id INTEGER, notes_original TEXT, notes_english TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (parent_place_id) REFERENCES places(id) ON DELETE CASCADE, FOREIGN KEY (child_place_id) REFERENCES places(id) ON DELETE CASCADE, FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL, CHECK (parent_place_id != child_place_id), UNIQUE ( parent_place_id, child_place_id, relationship_type ) );

-- place_sources
CREATE TABLE place_sources ( id INTEGER PRIMARY KEY AUTOINCREMENT, place_id INTEGER NOT NULL, source_id INTEGER NOT NULL, external_id TEXT, source_url TEXT, status TEXT NOT NULL DEFAULT 'active', last_verified_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE, FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE, UNIQUE (source_id, external_id) );

-- place_tags
CREATE TABLE place_tags ( place_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (place_id, tag_id), FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE, FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE );

-- place_translations
CREATE TABLE place_translations ( id INTEGER PRIMARY KEY AUTOINCREMENT, place_id INTEGER NOT NULL, language_code TEXT NOT NULL, display_name TEXT NOT NULL, short_description TEXT, full_description TEXT, translation_status TEXT NOT NULL DEFAULT 'original' CHECK (translation_status IN ( 'original', 'official', 'machine', 'reviewed' )), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE, UNIQUE (place_id, language_code) );

-- places
CREATE TABLE places ( id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, place_type TEXT NOT NULL, official_name TEXT NOT NULL, original_language TEXT NOT NULL DEFAULT 'pt-PT', neighborhood TEXT, city TEXT NOT NULL DEFAULT 'Lisboa', country_code TEXT NOT NULL DEFAULT 'PT', address TEXT, postal_code TEXT, latitude REAL, longitude REAL, official_website TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ( 'active', 'temporarily_closed', 'permanently_closed' )), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP , parent_place_id INTEGER REFERENCES places(id) ON DELETE SET NULL, locality_id INTEGER REFERENCES localities(id) ON DELETE SET NULL);

-- program_categories
CREATE TABLE program_categories ( program_id INTEGER NOT NULL, category_id INTEGER NOT NULL, PRIMARY KEY (program_id, category_id), FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE, FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE );

-- program_credits
CREATE TABLE program_credits ( id INTEGER PRIMARY KEY AUTOINCREMENT, program_id INTEGER NOT NULL, credit_type TEXT NOT NULL, person_name TEXT NOT NULL, character_or_role TEXT, sort_order INTEGER NOT NULL DEFAULT 100, source_id INTEGER, notes_original TEXT, notes_english TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE, FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL );

-- program_details
CREATE TABLE program_details ( id INTEGER PRIMARY KEY AUTOINCREMENT, program_id INTEGER NOT NULL UNIQUE, original_work_title TEXT, work_type TEXT, original_year INTEGER, country_code TEXT, runtime_minutes INTEGER, original_language TEXT, presentation_language TEXT, subtitle_language TEXT, surtitles_language TEXT, content_rating TEXT, source_id INTEGER, notes_original TEXT, notes_english TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE, FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL );

-- program_occurrences
CREATE TABLE program_occurrences ( id INTEGER PRIMARY KEY AUTOINCREMENT, program_id INTEGER NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT, timezone TEXT NOT NULL DEFAULT 'Europe/Lisbon', status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ( 'scheduled', 'cancelled', 'postponed', 'sold_out', 'waitlist', 'completed' )), capacity INTEGER, places_remaining INTEGER, source_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, place_id INTEGER REFERENCES places(id) ON DELETE SET NULL, external_id TEXT, FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE, FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL );

-- program_sources
CREATE TABLE program_sources ( id INTEGER PRIMARY KEY AUTOINCREMENT, program_id INTEGER NOT NULL, source_id INTEGER NOT NULL, external_id TEXT, source_url TEXT, role TEXT NOT NULL DEFAULT 'reference' CHECK ( role IN ( 'primary', 'verification', 'discovery', 'ticketing', 'reference' ) ), last_verified_at TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK ( status IN ( 'active', 'missing', 'changed', 'retired' ) ), notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE, FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE, UNIQUE (program_id, source_id, source_url) );

-- program_tags
CREATE TABLE program_tags ( program_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (program_id, tag_id), FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE, FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE );

-- program_ticket_conditions
CREATE TABLE program_ticket_conditions ( id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_rule_id INTEGER NOT NULL, condition_type TEXT NOT NULL, operator TEXT NOT NULL DEFAULT 'equals', value_text TEXT, value_number REAL, requirement_group INTEGER NOT NULL DEFAULT 1, notes_original TEXT, notes_english TEXT, FOREIGN KEY (ticket_rule_id) REFERENCES program_ticket_rules(id) ON DELETE CASCADE );

-- program_ticket_discount_conditions
CREATE TABLE program_ticket_discount_conditions ( id INTEGER PRIMARY KEY AUTOINCREMENT, discount_id INTEGER NOT NULL, condition_type TEXT NOT NULL, operator TEXT NOT NULL DEFAULT 'equals', value_text TEXT, value_number REAL, requirement_group INTEGER NOT NULL DEFAULT 1, notes_original TEXT, notes_english TEXT, FOREIGN KEY (discount_id) REFERENCES program_ticket_discounts(id) ON DELETE CASCADE );

-- program_ticket_discount_tiers
CREATE TABLE program_ticket_discount_tiers ( discount_id INTEGER NOT NULL, ticket_rule_id INTEGER NOT NULL, PRIMARY KEY ( discount_id, ticket_rule_id ), FOREIGN KEY (discount_id) REFERENCES program_ticket_discounts(id) ON DELETE CASCADE, FOREIGN KEY (ticket_rule_id) REFERENCES program_ticket_rules(id) ON DELETE CASCADE );

-- program_ticket_discounts
CREATE TABLE program_ticket_discounts ( id INTEGER PRIMARY KEY AUTOINCREMENT, program_id INTEGER NOT NULL, discount_name_original TEXT, discount_name_english TEXT NOT NULL, discount_type TEXT NOT NULL CHECK ( discount_type IN ( 'percentage', 'fixed_price', 'amount_off' ) ), discount_value REAL NOT NULL, currency TEXT DEFAULT 'EUR', minimum_base_price_cents INTEGER, proof_required INTEGER NOT NULL DEFAULT 0 CHECK (proof_required IN (0, 1)), valid_from TEXT, valid_until TEXT, source_id INTEGER, notes_original TEXT, notes_english TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE, FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL );

-- program_ticket_rules
CREATE TABLE program_ticket_rules ( id INTEGER PRIMARY KEY AUTOINCREMENT, program_id INTEGER NOT NULL, occurrence_id INTEGER, ticket_name_original TEXT, ticket_name_english TEXT NOT NULL, price_cents INTEGER, currency TEXT NOT NULL DEFAULT 'EUR', pricing_type TEXT NOT NULL DEFAULT 'fixed' CHECK ( pricing_type IN ( 'fixed', 'free', 'percentage_discount', 'amount_discount' ) ), discount_value REAL, valid_from TEXT, valid_until TEXT, proof_required INTEGER NOT NULL DEFAULT 0 CHECK (proof_required IN (0, 1)), source_id INTEGER, notes_original TEXT, notes_english TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE, FOREIGN KEY (occurrence_id) REFERENCES program_occurrences(id) ON DELETE CASCADE, FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL );

-- program_translations
CREATE TABLE program_translations ( id INTEGER PRIMARY KEY AUTOINCREMENT, program_id INTEGER NOT NULL, language_code TEXT NOT NULL, display_title TEXT NOT NULL, short_description TEXT, full_description TEXT, translation_status TEXT NOT NULL DEFAULT 'original' CHECK (translation_status IN ( 'original', 'official', 'machine', 'reviewed' )), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE, UNIQUE (program_id, language_code) );

-- programs
CREATE TABLE programs ( id INTEGER PRIMARY KEY AUTOINCREMENT, place_id INTEGER, program_type TEXT NOT NULL CHECK (program_type IN ( 'concert', 'exhibition', 'performance', 'film', 'class', 'workshop', 'tour', 'talk', 'festival', 'outdoor', 'social', 'activity', 'other' )), official_title TEXT NOT NULL, original_language TEXT NOT NULL DEFAULT 'pt-PT', status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ( 'announced', 'scheduled', 'cancelled', 'postponed', 'completed' )), source_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE SET NULL, FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL );

-- provider_health
CREATE TABLE provider_health ( provider TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'unknown', last_attempt_at TEXT, last_success_at TEXT, last_failure_at TEXT, consecutive_failures INTEGER NOT NULL DEFAULT 0, last_error_id TEXT, last_http_status INTEGER, last_operation TEXT, last_duration_ms INTEGER, last_item_count INTEGER, metadata_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );

-- schedule_exceptions
CREATE TABLE schedule_exceptions ( id INTEGER PRIMARY KEY AUTOINCREMENT, place_id INTEGER NOT NULL, exception_date TEXT NOT NULL, exception_type TEXT NOT NULL CHECK (exception_type IN ( 'closed', 'special_hours', 'open' )), opens_at TEXT, closes_at TEXT, note_original TEXT, note_language TEXT DEFAULT 'pt-PT', note_english TEXT, source_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE, FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL );

-- search_aliases
CREATE TABLE search_aliases ( id INTEGER PRIMARY KEY AUTOINCREMENT, alias TEXT NOT NULL, tag_id INTEGER NOT NULL, language_code TEXT NOT NULL DEFAULT 'en', priority INTEGER NOT NULL DEFAULT 100, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE, UNIQUE(alias, tag_id, language_code) );

-- source_fetches
CREATE TABLE source_fetches ( id INTEGER PRIMARY KEY AUTOINCREMENT, source_target_id INTEGER NOT NULL, fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, http_status INTEGER, fetch_status TEXT NOT NULL CHECK ( fetch_status IN ( 'success', 'not_modified', 'failed' ) ), content_hash TEXT, content_type TEXT, error_message TEXT, FOREIGN KEY (source_target_id) REFERENCES source_targets(id) ON DELETE CASCADE );

-- source_targets
CREATE TABLE source_targets ( id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER NOT NULL, target_type TEXT NOT NULL CHECK ( target_type IN ( 'webpage', 'calendar', 'rss', 'api', 'json', 'ical', 'sitemap', 'other' ) ), url TEXT NOT NULL, purpose TEXT CHECK ( purpose IN ( 'events', 'exhibitions', 'performances', 'classes', 'activities', 'opening_hours', 'admission', 'memberships', 'mixed', 'other' ) ), language_code TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ( 'active', 'paused', 'broken', 'retired' )), fetch_frequency_minutes INTEGER, last_fetched_at TEXT, last_success_at TEXT, last_changed_at TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE, UNIQUE (source_id, url) );

-- sources
CREATE TABLE sources ( id INTEGER PRIMARY KEY AUTOINCREMENT, place_id INTEGER, source_type TEXT NOT NULL CHECK (source_type IN ( 'official_website', 'official_ticketing', 'government', 'tourism_board', 'organizer', 'social_media', 'user_submission', 'other' )), url TEXT NOT NULL, title TEXT, language_code TEXT, is_authoritative INTEGER NOT NULL DEFAULT 0 CHECK (is_authoritative IN (0, 1)), last_checked_at TEXT, last_changed_at TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ( 'active', 'unavailable', 'superseded' )), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE );

-- system_errors
CREATE TABLE system_errors ( id INTEGER PRIMARY KEY AUTOINCREMENT, error_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, provider TEXT, operation TEXT, stage TEXT, severity TEXT NOT NULL DEFAULT 'error', error_name TEXT, error_message TEXT NOT NULL, stack_trace TEXT, source_file TEXT, source_line INTEGER, source_column INTEGER, request_method TEXT, request_url TEXT, http_status INTEGER, reproduction_json TEXT, context_json TEXT, first_occurred_at TEXT NOT NULL, last_occurred_at TEXT NOT NULL, occurrence_count INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'open', resolved_at TEXT, first_notification_at TEXT, last_notification_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );

-- tags
CREATE TABLE tags ( id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name_english TEXT NOT NULL, name_portuguese TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );

-- ============================================================
-- INDEXES
-- ============================================================

-- idx_action_dates_occurrence
CREATE INDEX idx_action_dates_occurrence ON action_dates(occurrence_id);

-- idx_action_dates_program
CREATE INDEX idx_action_dates_program ON action_dates(program_id);

-- idx_action_dates_time
CREATE INDEX idx_action_dates_time ON action_dates(action_at);

-- idx_action_dates_type
CREATE INDEX idx_action_dates_type ON action_dates(action_type);

-- idx_admission_age
CREATE INDEX idx_admission_age ON admission_rules(min_age, max_age);

-- idx_admission_conditions_rule
CREATE INDEX idx_admission_conditions_rule ON admission_conditions(admission_rule_id);

-- idx_admission_conditions_type
CREATE INDEX idx_admission_conditions_type ON admission_conditions(condition_type);

-- idx_admission_place
CREATE INDEX idx_admission_place ON admission_rules(place_id);

-- idx_admission_time_day
CREATE INDEX idx_admission_time_day ON admission_time_rules(day_of_week);

-- idx_admission_time_rule
CREATE INDEX idx_admission_time_rule ON admission_time_rules(admission_rule_id);

-- idx_admission_validity
CREATE INDEX idx_admission_validity ON admission_rules(valid_from, valid_until);

-- idx_membership_benefits_membership
CREATE INDEX idx_membership_benefits_membership ON membership_benefits(membership_id);

-- idx_membership_conditions_membership
CREATE INDEX idx_membership_conditions_membership ON membership_conditions(membership_id);

-- idx_membership_sources_membership
CREATE INDEX idx_membership_sources_membership ON membership_sources(membership_id);

-- idx_memberships_place
CREATE INDEX idx_memberships_place ON memberships(place_id);

-- idx_occurrences_program
CREATE INDEX idx_occurrences_program ON program_occurrences(program_id);

-- idx_occurrences_start
CREATE INDEX idx_occurrences_start ON program_occurrences(starts_at);

-- idx_occurrences_status
CREATE INDEX idx_occurrences_status ON program_occurrences(status);

-- idx_opening_hours_place_day
CREATE INDEX idx_opening_hours_place_day ON opening_hours(place_id, day_of_week);

-- idx_place_aliases_alias
CREATE INDEX idx_place_aliases_alias ON place_aliases(alias);

-- idx_place_aliases_place
CREATE INDEX idx_place_aliases_place ON place_aliases(place_id);

-- idx_place_relationships_child
CREATE INDEX idx_place_relationships_child ON place_relationships(child_place_id);

-- idx_place_relationships_parent
CREATE INDEX idx_place_relationships_parent ON place_relationships(parent_place_id);

-- idx_place_relationships_type
CREATE INDEX idx_place_relationships_type ON place_relationships(relationship_type);

-- idx_place_sources_place
CREATE INDEX idx_place_sources_place ON place_sources(place_id);

-- idx_place_sources_source_external
CREATE INDEX idx_place_sources_source_external ON place_sources(source_id, external_id);

-- idx_place_translations_language
CREATE INDEX idx_place_translations_language ON place_translations(language_code);

-- idx_place_translations_place
CREATE INDEX idx_place_translations_place ON place_translations(place_id);

-- idx_places_parent
CREATE INDEX idx_places_parent ON places(parent_place_id);

-- idx_program_credits_program
CREATE INDEX idx_program_credits_program ON program_credits(program_id);

-- idx_program_credits_type
CREATE INDEX idx_program_credits_type ON program_credits(program_id, credit_type);

-- idx_program_occurrences_source_external
CREATE INDEX idx_program_occurrences_source_external ON program_occurrences(source_id, external_id);

-- idx_program_occurrences_source_external_unique
CREATE UNIQUE INDEX idx_program_occurrences_source_external_unique ON program_occurrences(source_id, external_id) WHERE external_id IS NOT NULL;

-- idx_program_sources_program
CREATE INDEX idx_program_sources_program ON program_sources(program_id);

-- idx_program_sources_source
CREATE INDEX idx_program_sources_source ON program_sources(source_id);

-- idx_program_sources_source_external_unique
CREATE UNIQUE INDEX idx_program_sources_source_external_unique ON program_sources(source_id, external_id) WHERE external_id IS NOT NULL;

-- idx_program_ticket_conditions_rule
CREATE INDEX idx_program_ticket_conditions_rule ON program_ticket_conditions(ticket_rule_id);

-- idx_program_ticket_discount_conditions
CREATE INDEX idx_program_ticket_discount_conditions ON program_ticket_discount_conditions(discount_id);

-- idx_program_ticket_discounts_program
CREATE INDEX idx_program_ticket_discounts_program ON program_ticket_discounts(program_id);

-- idx_program_ticket_rules_occurrence
CREATE INDEX idx_program_ticket_rules_occurrence ON program_ticket_rules(occurrence_id);

-- idx_program_ticket_rules_program
CREATE INDEX idx_program_ticket_rules_program ON program_ticket_rules(program_id);

-- idx_program_translations_language
CREATE INDEX idx_program_translations_language ON program_translations(language_code);

-- idx_program_translations_program
CREATE INDEX idx_program_translations_program ON program_translations(program_id);

-- idx_programs_place
CREATE INDEX idx_programs_place ON programs(place_id);

-- idx_programs_status
CREATE INDEX idx_programs_status ON programs(status);

-- idx_programs_type
CREATE INDEX idx_programs_type ON programs(program_type);

-- idx_provider_health_last_failure
CREATE INDEX idx_provider_health_last_failure ON provider_health(last_failure_at DESC);

-- idx_provider_health_status
CREATE INDEX idx_provider_health_status ON provider_health(status);

-- idx_schedule_exceptions_place_date
CREATE INDEX idx_schedule_exceptions_place_date ON schedule_exceptions(place_id, exception_date);

-- idx_search_aliases_alias
CREATE INDEX idx_search_aliases_alias ON search_aliases(alias);

-- idx_source_fetches_target_time
CREATE INDEX idx_source_fetches_target_time ON source_fetches(source_target_id, fetched_at DESC);

-- idx_sources_authoritative
CREATE INDEX idx_sources_authoritative ON sources(is_authoritative);

-- idx_sources_last_checked
CREATE INDEX idx_sources_last_checked ON sources(last_checked_at);

-- idx_sources_place
CREATE INDEX idx_sources_place ON sources(place_id);

-- idx_system_errors_fingerprint
CREATE INDEX idx_system_errors_fingerprint ON system_errors(fingerprint);

-- idx_system_errors_last_occurred
CREATE INDEX idx_system_errors_last_occurred ON system_errors(last_occurred_at DESC);

-- idx_system_errors_provider
CREATE INDEX idx_system_errors_provider ON system_errors(provider);

-- idx_system_errors_status
CREATE INDEX idx_system_errors_status ON system_errors(status);

