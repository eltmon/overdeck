-- PAN-5071: the bot and machine names a device-code request may carry (display-only claims, at most 64 characters).
-- No semicolons inside comments: the Miniflare test splits statements on a semicolon at line end.
ALTER TABLE device_grants ADD COLUMN client_name TEXT;
ALTER TABLE device_grants ADD COLUMN target_name TEXT;
