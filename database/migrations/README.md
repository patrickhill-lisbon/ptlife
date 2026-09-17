# PTLife Database Migrations

This directory contains SQL migrations for upgrading an existing PTLife database.

## Rules

- `database/schema/0000_baseline.sql` creates a new database from scratch.
- Files in this directory modify an existing database.
- Never run the baseline schema against an existing production database.
- Each schema change gets a new numbered migration.
- Migrations are applied in numerical order.
- Once a migration has been applied to production, do not edit it. Create a new migration instead.
- After a migration is applied successfully, update the baseline schema so it continues to represent the complete current schema for new databases.

## Naming

Use sequential names such as:

`0001_add_example_column.sql`
`0002_create_example_table.sql`
`0003_add_example_index.sql`
