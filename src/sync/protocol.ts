import { z } from 'zod';
import type { StatusState } from '../types.js';

/**
 * Wire protocol for the sync relay. Messages are JSON. The protocol is
 * deliberately tiny: peers join a room, publish their own StatusState, and
 * receive the state (and presence) of the other peer(s) in that room.
 */

export const PROTOCOL_VERSION = 1;

const statusTimerSchema = z.object({
  kind: z.enum(['focus', 'break', 'long_break', 'custom']),
  endsAt: z.number(),
  paused: z.boolean(),
  remainingMs: z.number().optional(),
  label: z.string().optional(),
});

export const statusStateSchema: z.ZodType<StatusState> = z.object({
  statusId: z.string(),
  label: z.string(),
  color: z.string(),
  alert: z.boolean(),
  timer: statusTimerSchema.nullable().optional(),
  updatedAt: z.number(),
});

// ---- client -> server ----

const helloSchema = z.object({
  type: z.literal('hello'),
  protocol: z.number(),
  room: z.string().min(1),
  peerId: z.string().min(1),
  name: z.string().min(1),
  state: statusStateSchema.nullable(),
});

const stateSchema = z.object({
  type: z.literal('state'),
  state: statusStateSchema,
});

const pingSchema = z.object({ type: z.literal('ping') });

export const clientMessageSchema = z.discriminatedUnion('type', [helloSchema, stateSchema, pingSchema]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---- server -> client ----

const peerStateSchema = z.object({
  type: z.literal('peer_state'),
  peerId: z.string(),
  name: z.string(),
  state: statusStateSchema.nullable(),
});

const peerLeftSchema = z.object({
  type: z.literal('peer_left'),
  peerId: z.string(),
});

const welcomeSchema = z.object({
  type: z.literal('welcome'),
  peerId: z.string(),
});

const pongSchema = z.object({ type: z.literal('pong') });

const errorSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
});

export const serverMessageSchema = z.discriminatedUnion('type', [
  welcomeSchema,
  peerStateSchema,
  peerLeftSchema,
  pongSchema,
  errorSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string): ClientMessage {
  return clientMessageSchema.parse(JSON.parse(raw));
}

export function decodeServer(raw: string): ServerMessage {
  return serverMessageSchema.parse(JSON.parse(raw));
}
