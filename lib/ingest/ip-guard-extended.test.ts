import { describe, expect, it } from 'vitest';
import {
  isDangerousIp,
  isMetadataIp,
  isMulticastIp,
  isNat64Ip,
  isReservedIp,
  ipv4InCidr,
} from './ip-guard';

describe('extended IP classification', () => {
  it('detects multicast IPv4 and IPv6', () => {
    expect(isMulticastIp('224.0.0.1')).toBe(true);
    expect(isMulticastIp('239.255.255.255')).toBe(true);
    expect(isMulticastIp('8.8.8.8')).toBe(false);
    expect(isMulticastIp('ff02::1')).toBe(true);
  });

  it('detects reserved IPv4 240/4', () => {
    expect(isReservedIp('240.0.0.1')).toBe(true);
    expect(isReservedIp('255.255.255.255')).toBe(true);
    expect(isReservedIp('223.255.255.255')).toBe(false);
  });

  it('detects NAT64 prefixes', () => {
    expect(isNat64Ip('64:ff9b::1')).toBe(true);
    expect(isNat64Ip('64:ff9b:1::1')).toBe(true);
    expect(isNat64Ip('2001:db8::1')).toBe(false);
  });

  it('marks metadata and dangerous addresses', () => {
    expect(isMetadataIp('169.254.169.254')).toBe(true);
    expect(isDangerousIp('224.1.1.1')).toBe(true);
    expect(isDangerousIp('240.0.0.1')).toBe(true);
    expect(isDangerousIp('8.8.8.8')).toBe(false);
  });

  it('matches IPv4 CIDRs', () => {
    expect(ipv4InCidr('10.1.2.3', '10.0.0.0/8')).toBe(true);
    expect(ipv4InCidr('11.0.0.1', '10.0.0.0/8')).toBe(false);
  });
});
