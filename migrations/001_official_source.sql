-- The official source's own record. It keeps who wrote and what was delivered,
-- never what a message said: text only passes through on its way to the person
-- or agent a route names.
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE contacts (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  last_at INTEGER NOT NULL DEFAULT 0,
  held INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE routes (
  contact TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  preview INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE deliveries (
  message_id TEXT NOT NULL,
  target TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (message_id, target)
);
CREATE INDEX deliveries_at ON deliveries (at);
