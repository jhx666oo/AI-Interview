-- The column is part of the baseline `users` schema and is also created by
-- the legacy bootstrap path. Keep this migration as a recorded no-op so
-- production databases that already have the column can advance to 0026.
SELECT 1;
