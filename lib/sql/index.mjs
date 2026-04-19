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
    const dbError = new Error(message, { cause: err });
    dbError.code = err.code || 'DB_ERROR';
    dbError.context = context;
    throw dbError;
  }

  /**
   * Helper method to validate modification operations (update/delete) affected exactly one row
   * @private
   */
  _validateModification(result, minChanges = 1, maxChanges = 1) {
    if (result.changes === 0 && minChanges > 0) {
      const error = new Error(`No rows affected, expected at least ${minChanges}`);
      error.code = 'DB_NO_CHANGE';
      throw error;
    }
    if (result.changes < minChanges) {
      const error = new Error(`Not enough rows affected (${result.changes}), expected at least ${minChanges}`);
      error.code = 'DB_NOT_ENOUGH_CHANGES';
      throw error;
    }
    if (result.changes > maxChanges) {
      const error = new Error(`Too many rows affected (${result.changes}), expected at most ${maxChanges}`);
      error.code = 'DB_TOO_MANY_CHANGES';
      throw error;
    }
    return result;
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
      return this._sql.get`SELECT * FROM bullet WHERE id = ${id}` ?? null;
    } catch (err) {
      this._handleError(err, { method: 'bullet_read_by_id', details: { id } });
    }
  }

  /**
   * Create a new bullet
   * @param {string} content - Bullet content
   * @return {number} ID of the created bullet
   * @deprecated This method is for administrative use only. For user submissions, use patch_bullet_create instead to create a pending patch.
   */
  bulletin_create(content) {
    try {
      const res = this._validateModification(
        this._sql.run`INSERT INTO bullet (content) VALUES (${content})`
      );
      return res.lastInsertRowid;
    } catch (err) {
      this._handleError(err, { method: 'bullet_create', details: { content } });
    }
  }

  /**
   * Update the active status of a bullet
   * @param {number} id - Bullet ID
   * @param {boolean} is_active - New active status
   * @returns {number} ID of the updated bullet
   * @deprecated This method is for administrative use only. For user submissions, use patch_bullet_create_active_change instead to create a pending patch for approval.
   */
  bulletin_update_active(id, is_active) {
    try {
      const res = this._validateModification(
        this._sql.run`UPDATE bullet SET is_active = ${is_active ? 1 : 0} WHERE id = ${id}`
      );
      return id;
    } catch (err) {
      this._handleError(err, { method: 'bullet_update_active', details: { id, is_active } });
    }
  }

  /**
   * Update the content of a bullet
   * @param {number} id - Bullet ID
   * @param {string} content - New content
   * @returns {number} ID of the updated bullet
   * @deprecated This method is for administrative use only. For user submissions, use patch_bullet_create_content_change instead to create a pending patch for approval.
   */
  bulletin_update_content(id, content) {
    try {
      const res = this._validateModification(
        this._sql.run`UPDATE bullet SET content = ${content} WHERE id = ${id}`
      );
      return id;
    } catch (err) {
      this._handleError(err, { method: 'bullet_update_content', details: { id, content } });
    }
  }

  /**
   * Update both content and active status of a bullet
   * @param {number} id - Bullet ID
   * @param {string} content - New content
   * @param {boolean} is_active - New active status
   * @returns {number} ID of the updated bullet
   * @deprecated This method is for administrative use only. For user submissions, use patch_bullet_create_full_change instead to create a pending patch for approval.
   */
  bulletin_update_full(id, content, is_active) {
    try {
      const res = this._validateModification(
        this._sql.run`
          UPDATE bullet SET 
            content = ${content},
            is_active = ${is_active ? 1 : 0}
          WHERE id = ${id}
        `
      );
      return id;
    } catch (err) {
      this._handleError(err, { method: 'bullet_update_full', details: { id, is_active, content } });
    }
  }

  /**
   * Delete a bullet by ID
   * @param {number} id - Bullet ID
   * @returns {number} ID of the deleted bullet
   * @deprecated This method is for administrative use only.
   */
  bulletin_delete(id) {
    try {
      this._validateModification(
        this._sql.run`DELETE FROM bullet WHERE id = ${id}`
      );
      return id;
    } catch (err) {
      this._handleError(err, { method: 'bullet_delete', details: { id } });
    }
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
   * Read version history of a bullet (approved patches only)
   * @param {number} bullet_id - Bullet ID
   * @param {Object} options - Optional configuration
   * @param {boolean} options.includeRejected - Include rejected patches (default: false)
   * @returns {Array} List of patches (versions) for this bullet
   */
  patch_bullet_read_by_bulletid(bullet_id, options = { includeRejected: false }) {
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
      this._handleError(err, { method: 'patch_bullet_read_by_bulletid', details: { bullet_id, options } });
    }
  }

  /**
   * Create a new patch for a new bullet
   * @param {string} content - Bullet content
   * @return {number} ID of the created patch
   */
  patch_bullet_create(content) {
    try {
      const res = this._validateModification(
        this._sql.run`INSERT INTO bullet_patch (content) VALUES (${content})`
      );
      return res.lastInsertRowid;
    } catch (err) {
      this._handleError(err, { method: 'patch_bullet_create', details: { content } });
    }
  }

  /**
   * Create a patch for content changes
   * @param {number} bullet_id - ID of bullet to change
   * @param {string} content - New content
   * @return {number} ID of the created patch
   */
  patch_bullet_create_content_change(bullet_id, content) {
    try {
      const res = this._validateModification(
        this._sql.run`
          INSERT INTO bullet_patch (bullet_id, bullet_version, content)
          VALUES (
            ${bullet_id},
            (SELECT version FROM bullet WHERE id = ${bullet_id}),
            ${content}
          )
        `
      );
      return res.lastInsertRowid;
    } catch (err) {
      this._handleError(err, { method: 'patch_bullet_create_content_change', details: { bullet_id, content } });
    }
  }

  /**
   * Create a patch for archive/unarchive changes
   * @param {number} bullet_id - ID of bullet to archive/unarchive
   * @param {boolean} is_active - True to unarchive, false to archive
   * @return {number} ID of the created patch
   */
  patch_bullet_create_active_change(bullet_id, is_active) {
    try {
      const res = this._validateModification(
        this._sql.run`
          INSERT INTO bullet_patch (bullet_id, bullet_version, is_active)
          VALUES (
            ${bullet_id},
            (SELECT version FROM bullet WHERE id = ${bullet_id}),
            ${is_active ? 1 : 0}
          )
        `
      );
      return res.lastInsertRowid;
    } catch (err) {
      this._handleError(err, { method: 'patch_bullet_create_active_change', details: { bullet_id, is_active } });
    }
  }

  /**
   * Create a patch for both content and archive/unarchive changes
   * @param {number} bullet_id - ID of bullet to change
   * @param {string} content - New content
   * @param {boolean} is_active - True to unarchive, false to archive
   * @return {number} ID of the created patch
   */
  patch_bullet_create_full_change(bullet_id, content, is_active) {
    try {
      const res = this._validateModification(
        this._sql.run`
          INSERT INTO bullet_patch (bullet_id, bullet_version, content, is_active)
          VALUES (
            ${bullet_id},
            (SELECT version FROM bullet WHERE id = ${bullet_id}),
            ${content},
            ${is_active ? 1 : 0}
          )
        `
      );
      return res.lastInsertRowid;
    } catch (err) {
      this._handleError(err, { method: 'patch_bullet_create_full_change', details: { bullet_id, content, is_active } });
    }
  }

  /**
   * Approve a patch atomically
   * @param {number} patch_id - ID of patch to approve
   * @return {number} ID of the affected bullet (for new bullet patches, this is the newly created bullet ID; for updates, this is the existing bullet ID)
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
        let id = res.lastInsertRowid;

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

          id = null;
        }
        
        res = this._validateModification(res);
        
        // Mark this patch as approved
        this._sql.run`UPDATE bullet_patch SET
          bullet_id = COALESCE(${id}, bullet_id),
          status = 'A'
        WHERE id = ${patch_id}`;
        
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
        return id;
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
   * @return {number} ID of the rejected patch
   */
  patch_bullet_reject(patch_id) {
    try {
      this._validateModification(
        this._sql.run`UPDATE bullet_patch SET status = 'R' WHERE id = ${patch_id} AND status = 'P'`
      );
      return patch_id;
    } catch (err) {
      this._handleError(err, { method: 'patch_bullet_reject', details: { patch_id } });
    }
  }
}

export default Database;
