import test from 'node:test';
import assert from 'node:assert/strict';
import { isSuspiciousPath, maskIp, sameOrigin } from '../server/security.ts';

test('same-origin accepts matching host and rejects foreign origins', () => {
  assert.equal(sameOrigin('https://nexus.example', 'nexus.example'), true);
  assert.equal(sameOrigin('https://evil.example', 'nexus.example'), false);
  assert.equal(sameOrigin('not-a-url', 'nexus.example'), false);
});

test('configured public origin is authoritative behind a reverse proxy', () => {
  assert.equal(sameOrigin('https://app.example', 'internal:3000', 'https://app.example'), true);
  assert.equal(sameOrigin('https://evil.example', 'internal:3000', 'https://app.example'), false);
});

test('suspicious path detection catches traversal and common secret probes', () => {
  assert.equal(isSuspiciousPath('/api/../../etc/passwd'), true);
  assert.equal(isSuspiciousPath('/api/%2e%2e/%2e%2e/etc/passwd'), true);
  assert.equal(isSuspiciousPath('/.env'), true);
  assert.equal(isSuspiciousPath('/.git/config'), true);
  assert.equal(isSuspiciousPath('/api/ws/list'), false);
});

test('IP masking removes the final IPv4 octet and truncates IPv6', () => {
  assert.equal(maskIp('203.0.113.42'), '203.0.113.0');
  assert.equal(maskIp('2001:db8:abcd:12:1:2:3:4'), '2001:db8:abcd:12::');
});
