import { describe, it, expect } from 'vitest';
import { composeFrame, estimateTextWidth, SCREEN_WIDTH, SCREEN_HEIGHT } from './render.js';
import type { PartnerView, StatusState } from './types.js';

function state(partial: Partial<StatusState>): StatusState {
  return {
    statusId: 'available',
    label: 'Available',
    color: '#22C55EFF',
    alert: false,
    timer: null,
    updatedAt: 0,
    ...partial,
  };
}

const OPTS = { backgroundDim: 0.5, priority: 60 };

function offlinePartner(): PartnerView {
  return { peerId: null, name: 'Sam', presence: 'offline', state: null };
}

function byId(frame: { elements: Array<{ id: string }> }, id: string) {
  return frame.elements.find((e) => e.id === id) as any;
}

describe('composeFrame', () => {
  it('lays out two cards and a divider across the 72px screen', () => {
    const frame = composeFrame({
      me: { name: 'Grayson', state: state({}) },
      partner: offlinePartner(),
      now: 0,
      options: OPTS,
    });

    const meBg = byId(frame, 'me-bg');
    const div = byId(frame, 'divider');
    const partnerBg = byId(frame, 'partner-bg');

    expect(meBg.x).toBe(0);
    expect(meBg.width + div.width + partnerBg.width).toBe(SCREEN_WIDTH);
    expect(meBg.height).toBe(SCREEN_HEIGHT);
    expect(div.x).toBe(meBg.width);
    expect(partnerBg.x).toBe(meBg.width + div.width);
    expect(frame.application_name).toBe('busybuddy');
    expect(frame.priority).toBe(60);
  });

  it('shows my label and the partner name/label', () => {
    const frame = composeFrame({
      me: { name: 'Grayson', state: state({ label: 'Available' }) },
      partner: { peerId: 'p', name: 'Sam', presence: 'online', state: state({ label: 'In a meeting' }) },
      now: 0,
      options: OPTS,
    });
    expect(byId(frame, 'me-name').text).toBe('Grayson');
    expect(byId(frame, 'me-status').text).toBe('Available');
    expect(byId(frame, 'partner-name').text).toBe('Sam');
    expect(byId(frame, 'partner-status').text).toBe('In a meeting');
  });

  it('shows "Offline" for a disconnected partner and hides their old state', () => {
    const frame = composeFrame({
      me: { name: 'Grayson', state: state({}) },
      partner: offlinePartner(),
      now: 0,
      options: OPTS,
    });
    expect(byId(frame, 'partner-status').text).toBe('Offline');
  });

  it('blinks the LED when either side has an alerting status', () => {
    const recording = state({ statusId: 'recording', label: 'Recording', color: '#DC2626FF', alert: true });
    const frame = composeFrame({
      me: { name: 'Grayson', state: state({}) },
      partner: { peerId: 'p', name: 'Sam', presence: 'online', state: recording },
      now: 0,
      options: OPTS,
    });
    // Partner is recording → my bar should blink with the recording color.
    expect(frame.led_notification_color).toBe('#DC2626FF');
  });

  it('does not set an LED color when nothing is alerting', () => {
    const frame = composeFrame({
      me: { name: 'Grayson', state: state({}) },
      partner: offlinePartner(),
      now: 0,
      options: OPTS,
    });
    expect(frame.led_notification_color).toBeUndefined();
  });

  it('renders a live countdown element while a timer is running', () => {
    const withTimer = state({
      label: 'Focus',
      timer: { kind: 'focus', endsAt: 1_700_000_000, paused: false, label: 'Focus' },
    });
    const frame = composeFrame({
      me: { name: 'Grayson', state: withTimer },
      partner: offlinePartner(),
      now: 0,
      options: OPTS,
    });
    const timer = byId(frame, 'me-timer');
    expect(timer.type).toBe('countdown');
    expect(timer.timestamp).toBe('1700000000');
    expect(timer.direction).toBe('time_left');
  });

  it('renders a static MM:SS when the timer is paused', () => {
    const paused = state({
      label: 'Focus',
      timer: { kind: 'focus', endsAt: 0, paused: true, remainingMs: 5 * 60_000 + 3_000, label: 'Focus' },
    });
    const frame = composeFrame({
      me: { name: 'Grayson', state: paused },
      partner: offlinePartner(),
      now: 0,
      options: OPTS,
    });
    const timer = byId(frame, 'me-timer');
    expect(timer.type).toBe('text');
    expect(timer.text).toBe('5:03');
  });

  it('enables scrolling for labels that overflow the card', () => {
    const long = state({ label: 'Recording a very long video now' });
    const frame = composeFrame({
      me: { name: 'Grayson', state: long },
      partner: offlinePartner(),
      now: 0,
      options: OPTS,
    });
    const status = byId(frame, 'me-status');
    expect(status.scroll_rate).toBeGreaterThan(0);
  });

  it('estimateTextWidth grows with length', () => {
    expect(estimateTextWidth('AAAA', 'small')).toBeGreaterThan(estimateTextWidth('A', 'small'));
  });
});
