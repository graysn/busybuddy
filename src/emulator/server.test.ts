import { describe, it, expect, afterEach } from 'vitest';
import { BusyBar } from '@busy-app/busy-lib';
import { EmulatorServer } from './server.js';
import { DeviceClient } from '../device.js';

/**
 * Drives the emulator through both the official @busy-app/busy-lib client and
 * our own DeviceClient, proving the version-negotiation handshake and
 * DELETE-based clear work, and that our client forwards led_notification_color
 * (which busy-lib drops).
 */
describe('EmulatorServer + clients', () => {
  let server: EmulatorServer;

  afterEach(async () => {
    await server?.stop();
  });

  it('accepts a draw from the official busy-lib client', async () => {
    server = new EmulatorServer({ port: 0, host: '127.0.0.1', label: 'Test' });
    const { url } = await server.start();

    const bar = new BusyBar({ addr: url });
    await bar.DisplayDraw({
      application_name: 'busybuddy',
      priority: 60,
      elements: [
        {
          id: 'me-status',
          type: 'text',
          x: 1,
          y: 8,
          display: 'front',
          timeout: 0,
          text: 'Recording',
          font: 'small',
          color: '#FFFFFFFF',
        },
      ],
    });

    const frame = server.currentFrame();
    expect(frame.elements).toHaveLength(1);
    expect((frame.elements[0] as { text: string }).text).toBe('Recording');
  });

  it('forwards led_notification_color via DeviceClient (busy-lib drops it)', async () => {
    server = new EmulatorServer({ port: 0, host: '127.0.0.1', label: 'Test' });
    const { url } = await server.start();

    const client = new DeviceClient({ addr: url });
    await client.draw({
      application_name: 'busybuddy',
      priority: 60,
      led_notification_color: '#DC2626FF',
      elements: [],
    });
    expect(server.currentFrame().led).toBe('#DC2626FF');
  });

  it('clears the frame on clear (DELETE)', async () => {
    server = new EmulatorServer({ port: 0, host: '127.0.0.1', label: 'Test' });
    const { url } = await server.start();
    const client = new DeviceClient({ addr: url });

    await client.draw({
      application_name: 'busybuddy',
      priority: 60,
      elements: [
        { id: 'x', type: 'rectangle', x: 0, y: 0, display: 'front', timeout: 0, width: 10, height: 10, fill: 'solid', fill_colors: ['#FFFFFFFF'], border_width: 0, border_color: '#00000000' },
      ],
    });
    expect(server.currentFrame().elements).toHaveLength(1);

    await client.clear('busybuddy');
    expect(server.currentFrame().elements).toHaveLength(0);
  });

  it('serves the viewer page and a frame endpoint', async () => {
    server = new EmulatorServer({ port: 0, host: '127.0.0.1', label: 'Grayson' });
    const { url } = await server.start();

    const page = await fetch(url).then((r) => r.text());
    expect(page).toContain('<canvas');
    expect(page).toContain('Grayson');

    const frame = await fetch(`${url}/frame`).then((r) => r.json());
    expect(frame).toHaveProperty('elements');
    expect(frame).toHaveProperty('generation');
  });
});
