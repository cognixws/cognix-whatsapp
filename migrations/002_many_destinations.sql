-- A contact can tell as many agents and Assistants as the owner wants: one row
-- per destination, each with its own choice about the text.
CREATE TABLE routes_many (
  contact TEXT NOT NULL,
  target TEXT NOT NULL,
  preview INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (contact, target)
);
INSERT INTO routes_many (contact, target, preview) SELECT contact, target, preview FROM routes;
DROP TABLE routes;
ALTER TABLE routes_many RENAME TO routes;
