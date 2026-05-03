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
  }
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
