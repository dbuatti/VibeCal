SELECT
    conname AS constraint_name,
    pg_get_constraintdef(c.oid) AS constraint_definition
FROM
    pg_constraint c
JOIN
    pg_class t ON c.conrelid = t.oid
WHERE
    t.relname = 'calendar_events_cache';