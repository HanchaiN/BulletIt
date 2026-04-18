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

  // ============================================================================
  // PATCH OPERATIONS (Approval workflow)
  // ============================================================================

  /**
   * Read pending patches for approval
   * @returns {Array} List of pending patches with computed changeType
   */
  patch_bullet_read_pending() {
    try {
      return this._sql.all`
        SELECT 
          *,
          CASE 
            WHEN content IS NOT NULL AND is_active IS NOT NULL THEN 'mixed'
            WHEN content IS NOT NULL THEN 'content'
            WHEN is_active IS NOT NULL THEN 'archive'
            ELSE 'unknown'
          END as changeType
        FROM bullet_patch 
        WHERE status = 'P'
        ORDER BY id
      `;
    } catch (err) {
      this._handleError(err, { method: 'patch_bullet_read_pending', details: {} });
    }
  }

  /**
   * Create a new patch for a new bullet
   * @param {string} content - Bullet content
   */
  patch_bullet_create(content) {
    try {
      this._sql.run`INSERT INTO bullet_patch (content) VALUES (${content})`;
    } catch (err) {
      this._handleError(err, { method: 'patch_bullet_create', details: { content } });
    }
  }

  /**
   * Create a patch for content changes
   * @param {number} bullet_id - ID of bullet to change
   * @param {string} content - New content
   */
  patch_bullet_create_content_change(bullet_id, content) {
    try {
      this._sql.run`
        INSERT INTO bullet_patch (bullet_id, bullet_version, content)
        VALUES (
          ${bullet_id},
          (SELECT version FROM bullet WHERE id = ${bullet_id}),
          ${content}
        )
      `;
    } catch (err) {
      this._handleError(err, { method: 'patch_bullet_create_content_change', details: { bullet_id, content } });
    }
  }

  /**
   * Create a patch for archive/unarchive changes
   * @param {number} bullet_id - ID of bullet to archive/unarchive
   * @param {boolean} is_active - True to unarchive, false to archive
   */
  patch_bullet_create_active_change(bullet_id, is_active) {
    try {
      this._sql.run`
        INSERT INTO bullet_patch (bullet_id, bullet_version, is_active)
        VALUES (
          ${bullet_id},
          (SELECT version FROM bullet WHERE id = ${bullet_id}),
          ${is_active ? 1 : 0}
        )
      `;
    } catch (err) {
      this._handleError(err, { method: 'patch_bullet_create_active_change', details: { bullet_id, is_active } });
    }
  }

  /**
   * Approve a patch atomically
   * @param {number} patch_id - ID of patch to approve
   */
  patch_bullet_approve(patch_id) {
    try {
      this._database.exec('BEGIN');
      
      try {
        // Try to insert as new bullet (for new content patches)
        let res = this._sql.run`
          INSERT INTO bullet (id, content, is_active, version)
          SELECT bullet_id, content, COALESCE(is_active, 1), 1 
          FROM bullet_patch
          WHERE id = ${patch_id}
            AND status = 'P'
            AND bullet_version = 0
          ON CONFLICT(id) DO NOTHING
        `;

        if (!res.changes) {
          // Update existing bullet with patch content
          // Verify patch is pending and version matches before updating
          res = this._sql.run`
            UPDATE bullet SET
              version = version + 1,
              content = COALESCE(bullet_patch.content, bullet.content),
              is_active = COALESCE(bullet_patch.is_active, bullet.is_active)
            FROM bullet_patch
            WHERE bullet.id = bullet_patch.bullet_id
              AND bullet.version = bullet_patch.bullet_version
              AND bullet_patch.id = ${patch_id}
              AND bullet_patch.status = 'P'
          `;
        }

        // Mark this patch as approved
        this._sql.run`UPDATE bullet_patch SET status = 'A' WHERE id = ${patch_id}`;

        // Reject competing patches for same bullet+version
        this._sql.run`
          UPDATE bullet_patch SET status = 'R'
          FROM bullet_patch AS bp
          WHERE bp.id = ${patch_id}
            AND bullet_patch.bullet_id = bp.bullet_id
            AND bullet_patch.bullet_version = bp.bullet_version
            AND bullet_patch.status = 'P'
            AND bullet_patch.id <> ${patch_id}
        `;

        this._database.exec('COMMIT');
      } catch (err) {
        this._database.exec('ROLLBACK');
        throw err;
      }
    } catch (err) {
      this._handleError(err, { method: 'patch_bullet_approve', details: { patch_id } });
    }
  }

  /**
   * Reject a patch (only if pending)
   * @param {number} patch_id - ID of patch to reject
   */
  patch_bullet_reject(patch_id) {
    try {
      this._sql.run`UPDATE bullet_patch SET status = 'R' WHERE id = ${patch_id} AND status = 'P'`;
    } catch (err) {
      this._handleError(err, { method: 'patch_bullet_reject', details: { patch_id } });
    }
  }

  /**
   * Read version history of a bullet (approved patches only)
   * @param {number} bullet_id - Bullet ID
   * @param {Object} options - Optional configuration
   * @param {boolean} options.includeRejected - Include rejected patches (default: false)
   * @returns {Array} List of patches (versions) for this bullet
   */
  bullet_read_history(bullet_id, options = { includeRejected: false }) {
    try {
      if (options.includeRejected) {
        return this._sql.all`
          SELECT * FROM bullet_patch 
          WHERE bullet_id = ${bullet_id} AND status IN ('P', 'A')
          ORDER BY bullet_version
        `;
      } else {
        return this._sql.all`
          SELECT * FROM bullet_patch 
          WHERE bullet_id = ${bullet_id} AND status = 'A'
          ORDER BY bullet_version
        `;
      }
    } catch (err) {
      this._handleError(err, { method: 'bullet_read_history', details: { bullet_id, options } });
    }
  }

  /**
   * Deprecated: Use patch_bullet_create() instead
   */
  bulletin_create_patch(content) {
    return this.patch_bullet_create(content);
  }

  /**
   * Deprecated: Use patch_bullet_create_content_change() instead
   */
  bulletin_update_content_patch(id, content) {
    return this.patch_bullet_create_content_change(id, content);
  }

  /**
   * Deprecated: Use patch_bullet_create_active_change() instead
   */
  bulletin_update_active_patch(id, is_active) {
    return this.patch_bullet_create_active_change(id, is_active);
  }

  /**
   * Deprecated: Use patch_bullet_read_pending() instead
   */
  bulletin_read_patch() {
    return this.patch_bullet_read_pending();
  }

  /**
   * Deprecated: Use patch_bullet_approve() instead
   */
  bulletin_approve(id) {
    return this.patch_bullet_approve(id);
  }

  /**
   * Deprecated: Use patch_bullet_reject() instead
   */
  bulletin_reject(id) {
    return this.patch_bullet_reject(id);
  }
}

export default Database;
