import { describe, expect, it } from 'vitest';
import { isBlockedHostname, isBlockedIp, expandIpv6 } from './ip-guard';

describe('isBlockedIp', () => {
  it('blocks loopback and RFC1918 ranges', () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('10.0.0.1')).toBe(true);
    expect(isBlockedIp('172.16.0.1')).toBe(true);
    expect(isBlockedIp('192.168.1.1')).toBe(true);
    expect(isBlockedIp('169.254.169.254')).toBe(true);
    expect(isBlockedIp('0.0.0.0')).toBe(true);
  });

  it('allows public IPv4', () => {
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('1.1.1.1')).toBe(false);
  });

  it('blocks IPv6 loopback and link-local', () => {
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('fe80::1')).toBe(true);
    expect(isBlockedIp('fc00::1')).toBe(true);
  });

  it('blocks IPv4-mapped private addresses', () => {
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIp('::ffff:10.0.0.1')).toBe(true);
  });
});

describe('isBlockedHostname', () => {
  it('blocks localhost names', () => {
    expect(isBlockedHostname('localhost')).toBe(true);
    expect(isBlockedHostname('foo.localhost')).toBe(true);
  });

  it('treats literal IPs via isBlockedIp', () => {
    expect(isBlockedHostname('127.0.0.1')).toBe(true);
    expect(isBlockedHostname('8.8.8.8')).toBe(false);
  });
});

describe('expandIpv6', () => {
  it('expands ::1', () => {
    expect(expandIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });
});
