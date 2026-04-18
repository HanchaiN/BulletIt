import sqlite from 'node:sqlite';
import { migrate } from './migrate/index.mjs';

export function open(path = ':memory:') {
  const db = new sqlite.DatabaseSync(path);
  migrate(db);
  return new Database(db);
}

// TODO: asynchronous execution
export class Database {
  constructor(database) {
    this._database = database;
    this._sql = this._database.createTagStore();
  }

  /**
   * Helper method for consistent error handling and context
   * @private
   */
  _handleError(err, context) {
    const message = `Database error in ${context.method}: ${err.message}`;
    const dbError = new Error(message);
    dbError.code = err.code || 'DB_ERROR';
    dbError.context = context;
    throw dbError;
  }

  // ============================================================================
  // BULLET OPERATIONS (CRUD)
  // ============================================================================

  /**
   * Unified read method for bullets with filter support
   * @param {string} filter - 'active' (default), 'archive', or 'all'
   * @returns {Array} List of bullets matching the filter
   */
  bullet_read(filter = 'active') {
    try {
      switch (filter) {
        case 'active':
          return this._sql.all`SELECT * FROM bullet WHERE is_active <> 0 ORDER BY id`;
        case 'archive':
          return this._sql.all`SELECT * FROM bullet WHERE is_active = 0 ORDER BY id`;
        case 'all':
          return this._sql.all`SELECT * FROM bullet ORDER BY id`;
        default:
          throw new Error(`Invalid filter: ${filter}`);
      }
    } catch (err) {
      this._handleError(err, { method: 'bullet_read', details: { filter } });
    }
  }

  /**
   * Fetch a single bullet by ID
   * @param {number} id - Bullet ID
   * @returns {Object|null} Bullet object or null if not found
   */
  bullet_read_by_id(id) {
    try {
      return this._sql.get`SELECT * FROM bullet WHERE id = ${id}`;
    } catch (err) {
      this._handleError(err, { method: 'bullet_read_by_id', details: { id } });
    }
  }

  /**
   * Deprecated: Use bullet_read('active') instead
   */
  bulletin_read_active() {
    return this.bullet_read('active');
  }

  /**
   * Deprecated: Use bullet_read('archive') instead
   */
  bulletin_read_archive() {
    return this.bullet_read('archive');
  }

  /**
   * Deprecated: Use bullet_read('all') instead
   */
  bulletin_read_all() {
    return this.bullet_read('all');
  }

  /**
   * Deprecated: Use bullet_read_by_id() instead
   */
  bulletin_read_id(id) {
    return this.bullet_read_by_id(id);
  }

  bulletin_create(content) {
    return this._sql.run`INSERT INTO bullet (content) VALUES (${content})`;
  }

  bulletin_update_active(id, is_active) {
    return this._sql.run`UPDATE bullet SET is_active = ${is_active ? 1 : 0} WHERE id = ${id}`;
  }

  bulletin_update_content(id, content) {
    return this._sql.run`UPDATE bullet SET content = ${content} WHERE id = ${id}`;
  }

  bulletin_delete(id) {
    return this._sql.run`DELETE FROM bullet WHERE id = ${id}`;
  }
}

export default Database;
