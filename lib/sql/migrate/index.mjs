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
