/**
 * @typedef {import("node:sqlite").DatabaseSync} Database
 */

/**
 * @param {Database} database 
 * @returns {number}
 */
function get_migration_version(database) {
    return database.prepare('PRAGMA user_version').get().user_version;
}
/**
 * @param {Database} database 
 * @param {number} version
 */
function set_migration_version(database, version) {
    // Security: Validate version is a safe integer before using in SQL
    if (!Number.isInteger(version) || version < 0 || version > 255) {
        throw new Error('Invalid version: must be an integer between 0-255');
    }
    return database.exec(`PRAGMA user_version = ${version}`);
}

// TODO: Branching migrations with up & down for collab and merge
const migrations = [
  {
    version: 1,
    up: `
    CREATE TABLE bullet(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    is_active INTEGER DEFAULT TRUE
    ) STRICT;
    `,
  },
  {
    version: 2,
    up: `
    ALTER TABLE bullet ADD version INTEGER NOT NULL DEFAULT 1;
    CREATE TABLE bullet_patch(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bullet_id INTEGER,
    bullet_version INTEGER NOT NULL DEFAULT 0,
    content TEXT,
    is_active INTEGER,
    status TEXT CHECK( status IN ('P','A','R') ) NOT NULL DEFAULT 'P',
    FOREIGN KEY(bullet_id) REFERENCES bullet(id) ON DELETE CASCADE 
    ) STRICT;
    `,
  },
  {
    version: 3,
    up: `
    CREATE VIRTUAL TABLE bullet_fts USING FTS5(
      content, content='bullet', content_rowid='id',
      tokenize="trigram remove_diacritics 1"
    );
    INSERT INTO bullet_fts (rowid, content) SELECT id, content FROM bullet;

    CREATE TRIGGER bullet_insert_content AFTER
      INSERT ON bullet BEGIN
      INSERT INTO bullet_fts (rowid, content)
      VALUES (new.id, new.content); END;
    CREATE TRIGGER bullet_update_content AFTER
      UPDATE ON bullet BEGIN
      INSERT INTO bullet_fts (rowid, content)
      VALUES (new.id, new.content); END;
    CREATE TRIGGER bullet_delete_content AFTER
      DELETE ON bullet BEGIN
      DELETE FROM bullet_fts
      WHERE rowid = old.id; END;`,
  },
  {
    version: 4,
    up: `
    ALTER TABLE bullet ADD expire_at INTEGER;
    ALTER TABLE bullet ADD active_at INTEGER;
    ALTER TABLE bullet_patch ADD expire_at INTEGER;
    ALTER TABLE bullet_patch ADD active_at INTEGER;
    CREATE VIEW bullet_active AS
    SELECT
    id,
    (is_active AND UNIXEPOCH() BETWEEN COALESCE(active_at, 0) AND COALESCE(expire_at, UNIXEPOCH() + 5)) AS is_active
    FROM bullet;
    `,
  }, {
    version: 5,
    up: `
    ALTER TABLE bullet ADD title TEXT;
    ALTER TABLE bullet_patch ADD title TEXT;
    DROP TRIGGER IF EXISTS bullet_delete_content;
    DROP TRIGGER IF EXISTS bullet_update_content;
    DROP TRIGGER IF EXISTS bullet_insert_content;
    DROP TABLE IF EXISTS bullet_fts;
    CREATE VIRTUAL TABLE bullet_fts USING FTS5(
      title, content,
      content='bullet', content_rowid='id',
      tokenize="trigram remove_diacritics 1"
    );
    INSERT INTO bullet_fts (rowid, title, content) SELECT id, title, content FROM bullet;

    CREATE TRIGGER bullet_insert_content AFTER
      INSERT ON bullet BEGIN
      INSERT INTO bullet_fts (rowid, title, content)
      VALUES (new.id, new.title, new.content); END;
    CREATE TRIGGER bullet_update_content AFTER
      UPDATE ON bullet BEGIN
      INSERT INTO bullet_fts (rowid, title, content)
      VALUES (new.id, new.title, new.content); END;
    CREATE TRIGGER bullet_delete_content AFTER
      DELETE ON bullet BEGIN
      DELETE FROM bullet_fts
      WHERE rowid = old.id; END;
    `
  }, {
    version: 6,
    up: `
    ALTER TABLE bullet ADD image_uri TEXT;
    ALTER TABLE bullet_patch ADD image_uri TEXT;
    `,
  },
]

/**
 * @param {Database} database 
 */
export function migrate(database) {
  const current_version = get_migration_version(database);
  for (let migration of migrations) {
    if (migration.version <= current_version) continue;
    
    database.exec('BEGIN');
    try {
      database.exec(migration.up);
      set_migration_version(database, migration.version);
      database.exec('COMMIT');
    } catch (err) {
      database.exec('ROLLBACK');
      throw err;
    }
  }
}
