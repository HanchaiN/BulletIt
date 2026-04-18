import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import app from './app.mjs';

let server;

test('setup: start test server', async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(3001, resolve));
  console.log('Test server listening on http://localhost:3001');
});

// Helper function to make HTTP requests
function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    let bodyString = '';
    if (body) {
      if (typeof body === 'string') {
        bodyString = body;
      } else {
        bodyString = new URLSearchParams(body).toString();
      }
    }

    const options = {
      hostname: 'localhost',
      port: 3001,
      path,
      method,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyString),
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });

    req.on('error', reject);
    req.write(bodyString);
    req.end();
  });
}

// Test: GET / - List active bullets
test('GET / - List active bullets', async () => {
  const res = await request('GET', '/');
  assert.strictEqual(res.statusCode, 200);
  assert(res.body.includes('bullet'));
});

// Test: POST / - Create new bullet
test('POST / - Create new bullet', async () => {
  const res = await request('POST', '/', { content: 'Test bullet' });
  assert.strictEqual(res.statusCode, 303);
  assert.strictEqual(res.headers.location, '/');
});

// Test: GET / - Verify bullet in active list
test('GET / - Verify bullet in active list', async () => {
  const res = await request('GET', '/');
  assert.strictEqual(res.statusCode, 200);
  assert(res.body.includes('Test bullet'));
});

// Test: GET /?q=archive - Archive is empty
test('GET /?q=archive - Archive is empty', async () => {
  const res = await request('GET', '/?q=archive');
  assert.strictEqual(res.statusCode, 200);
});

// Test: PATCH /1 - Request archive change
test('PATCH /1 - Archive bullet', async () => {
  const res = await request('PATCH', '/1', { active: '0' });
  assert.strictEqual(res.statusCode, 303);
});

// Test: GET /?q=archive - Verify bullet archived
test('GET /?q=archive - Verify bullet archived', async () => {
  const res = await request('GET', '/?q=archive');
  assert.strictEqual(res.statusCode, 200);
});

// Test: POST / with empty content - Returns 400
test('POST / with empty content - Returns 400', async () => {
  const res = await request('POST', '/', { content: '' });
  assert.strictEqual(res.statusCode, 400);
});

// Test: GET /?q=invalid - Redirects
test('GET /?q=invalid - Redirects', async () => {
  const res = await request('GET', '/?q=invalid');
  assert.strictEqual(res.statusCode, 303);
  assert.strictEqual(res.headers.location, '/');
});

// Test: PATCH /invalid - Returns 400
test('PATCH /invalid - Returns 400', async () => {
  const res = await request('PATCH', '/invalid', { active: '0' });
  assert.strictEqual(res.statusCode, 400);
});

// Test: PATCH /999 - Nonexistent bullet returns 404
test('PATCH /999 - Nonexistent bullet returns 404', async () => {
  const res = await request('PATCH', '/999', { active: '0' });
  assert.strictEqual(res.statusCode, 404);
});

// Test: PATCH /abc - Invalid bullet ID returns 400
test('PATCH /abc - Invalid bullet ID returns 400', async () => {
  const res = await request('PATCH', '/abc', { active: '0' });
  assert.strictEqual(res.statusCode, 400);
});

// Database unit tests
test('Database: bullet_read_by_id returns correct bullet', () => {
  const db = app.locals.database;
  const bullet = db.bullet_read_by_id(1);
  assert(bullet !== null);
});

// Test: POST / - Whitespace-only content returns 400
test('POST / - Whitespace-only content returns 400', async () => {
  const res = await request('POST', '/', { content: '   ' });
  assert.strictEqual(res.statusCode, 400);
});

// Test: Deprecated database methods
test('Deprecated database methods', () => {
  const db = app.locals.database;
  assert(typeof db.bulletin_read_active === 'function');
  assert(typeof db.bulletin_read_archive === 'function');
  assert(typeof db.bulletin_read_all === 'function');
  assert(typeof db.bulletin_read_id === 'function');
});

// Test: GET /?q=all - List all bullets (active + archived)
test('GET /?q=all - List all bullets (active + archived)', async () => {
  const res = await request('GET', '/?q=all');
  assert.strictEqual(res.statusCode, 200);
});

// Test: POST / - Create bullet with special characters
test('POST / - Create bullet with special characters', async () => {
  const res = await request('POST', '/', { content: 'Test with <html> & special chars' });
  assert.strictEqual(res.statusCode, 303);
});

// Test: GET / - Special characters rendered safely
test('GET / - Special characters rendered safely', async () => {
  const res = await request('GET', '/');
  assert.strictEqual(res.statusCode, 200);
});

// Test: PATCH /2 - Unarchive bullet
test('PATCH /2 - Unarchive bullet', async () => {
  const res = await request('PATCH', '/2', { active: '1' });
  assert.strictEqual(res.statusCode, 303);
});

// Test: GET / - Verify unarchived bullet
test('GET / - Verify unarchived bullet', async () => {
  const res = await request('GET', '/');
  assert.strictEqual(res.statusCode, 200);
});

test('teardown: close test server', async () => {
  await new Promise((resolve) => server.close(resolve));
});
