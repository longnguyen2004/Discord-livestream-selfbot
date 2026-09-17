/**
 * TEMPORARY diagnostic tracer for unhandled socket `error` crashes
 * (EPIPE / ECONNRESET killing the bot).
 *
 * Enable with: TRACE_SOCKET_ERRORS=1
 *
 * When a `net.Socket` (this includes child-process stdio pipes, unix-socket
 * server connections from fluent-ffmpeg-simplified, and TLS sockets) emits
 * 'error' with no listener, this dumps to stderr *before* the process dies:
 * - the error code / syscall / message
 * - socket metadata (bytes read/written, local/remote, destroyed state)
 * - WHERE the socket came from: for server-accepted sockets this includes
 *   the stack of the code that created the server (e.g. StreamInput vs
 *   StreamOutput inside fluent-ffmpeg-simplified), for child stdio it shows
 *   the spawned command, for outbound sockets the connect target.
 *
 * It does not change behavior: after logging, the error is re-thrown exactly
 * as Node would have thrown it. When the env var is unset this module is a
 * no-op (zero overhead). Remove this file once the root cause is fixed.
 */
import net from "node:net";
import tls from "node:tls";
import cp from "node:child_process";
import fs from "node:fs";
import { EventEmitter } from "node:events";

const TAG = "[trace-socket-errors]";

type SocketInfo = {
  detail: string;
  stack: string;
};

const origins = new WeakMap<object, SocketInfo>();

function captureStack(depth = 14): string {
  const stack = new Error().stack ?? "";
  // Drop the "Error" line and this helper's own frame.
  return stack.split("\n").slice(2, 2 + depth).join("\n");
}

function truncate(value: string, max = 300): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function formatCallArgs(args: unknown[]): string {
  return truncate(
    args
      .map((a) => (typeof a === "function" ? "[cb]" : JSON.stringify(a) ?? "?"))
      .join(" "),
  );
}

function dumpSocketError(sock: net.Socket, err: unknown): void {
  const lines: string[] = [];
  lines.push(`${TAG} UNHANDLED 'error' on ${sock.constructor.name} (pid ${process.pid})`);
  if (err && typeof err === "object") {
    const e = err as NodeJS.ErrnoException;
    lines.push(`error: code=${e.code ?? "?"} errno=${e.errno ?? "?"} syscall=${e.syscall ?? "?"} message=${e.message ?? String(err)}`);
  } else {
    lines.push(`error: ${String(err)}`);
  }
  try {
    lines.push(
      `socket: bytesRead=${sock.bytesRead} bytesWritten=${sock.bytesWritten} ` +
        `connecting=${sock.connecting} pending=${sock.pending} ` +
        `destroyed=${sock.destroyed} closed=${sock.closed}`,
    );
    lines.push(`socket: local=${sock.localAddress ?? "?"}:${sock.localPort ?? "?"} remote=${sock.remoteAddress ?? "?"}:${sock.remotePort ?? "?"}`);
    const maybeTls = sock as unknown as Record<string, unknown>;
    if (typeof maybeTls.servername === "string")
      lines.push(`socket: servername=${maybeTls.servername as string}`);
    if (typeof maybeTls._host === "string")
      lines.push(`socket: _host=${maybeTls._host as string}`);
  } catch {
    lines.push("socket: <metadata unavailable>");
  }
  const origin = origins.get(sock);
  if (origin) {
    lines.push(`origin: ${origin.detail}`);
    lines.push(`creation stack:\n${origin.stack}`);
  } else {
    lines.push(
      "origin: untracked (socket was created before the tracer was installed, or via a path the tracer doesn't hook)",
    );
  }
  if (err instanceof Error && err.stack) lines.push(`error stack:\n${err.stack}`);
  try {
    fs.writeFileSync(2, `${lines.join("\n")}\n`);
  } catch {
    /* stderr gone; nothing more we can do */
  }
}

export function installSocketErrorTracing(): void {
  // Tag sockets accepted by any net.Server with the stack that created the
  // server. This is what identifies fluent-ffmpeg-simplified's internal
  // unix-socket pipes (the createServer call site is inside the library,
  // showing StreamInput vs StreamOutput vs progress pipe).
  const origCreateServer = net.createServer;
  const patchedCreateServer = function (this: unknown, ...args: unknown[]): net.Server {
    const server = Reflect.apply(origCreateServer, this, args) as net.Server;
    const listenStack = captureStack();
    server.on("connection", (sock: net.Socket) => {
      let addr = "?";
      try {
        addr = JSON.stringify(server.address()) ?? "?";
      } catch {
        /* ignore */
      }
      origins.set(sock, {
        detail: `accepted by net.Server bound at ${addr}`,
        stack: `server created at:\n${listenStack}\nconnection accepted at:\n${captureStack(6)}`,
      });
    });
    return server;
  };
  (net as unknown as { createServer: typeof patchedCreateServer }).createServer = patchedCreateServer;

  // Tag outbound sockets (plain TCP; e.g. non-TLS websocket transports).
  const origConnect = net.connect;
  const patchedConnect = function (this: unknown, ...args: unknown[]): net.Socket {
    const sock = Reflect.apply(origConnect, this, args) as net.Socket;
    origins.set(sock, {
      detail: `outbound net.connect ${formatCallArgs(args)}`,
      stack: captureStack(),
    });
    return sock;
  };
  (net as unknown as { connect: typeof patchedConnect }).connect = patchedConnect;

  // Tag outbound TLS sockets (e.g. Discord gateway / voice over wss).
  const origTlsConnect = tls.connect;
  const patchedTlsConnect = function (this: unknown, ...args: unknown[]): tls.TLSSocket {
    const sock = Reflect.apply(origTlsConnect, this, args) as tls.TLSSocket;
    origins.set(sock, {
      detail: `outbound tls.connect ${formatCallArgs(args)}`,
      stack: captureStack(),
    });
    return sock;
  };
  (tls as unknown as { connect: typeof patchedTlsConnect }).connect = patchedTlsConnect;

  // Tag child-process stdio pipes (ffmpeg, streamlink, yt-dlp) with the
  // spawned command.
  const origSpawn = cp.spawn;
  const patchedSpawn = function (this: unknown, ...args: unknown[]): cp.ChildProcess {
    const child = Reflect.apply(origSpawn, this, args) as cp.ChildProcess;
    const [cmd, cmdArgs] = args;
    const detail =
      `stdio of spawned process: ${String(cmd)} ` +
      `${Array.isArray(cmdArgs) ? (cmdArgs as unknown[]).slice(0, 6).join(" ") : ""}`.trim();
    const stack = captureStack();
    for (const stdio of [child.stdin, child.stdout, child.stderr]) {
      if (stdio) origins.set(stdio, { detail: truncate(detail), stack });
    }
    return child;
  };
  (cp as unknown as { spawn: typeof patchedSpawn }).spawn = patchedSpawn;

  // Hook error emissions: only sockets, only when nobody listens (i.e. only
  // in the exact situation that would crash the process). Everything else
  // passes straight through.
  const origEmit = EventEmitter.prototype.emit;
  EventEmitter.prototype.emit = function (
    this: EventEmitter,
    type: string | symbol,
    ...args: unknown[]
  ): boolean {
    if (
      type === "error" &&
      this instanceof net.Socket &&
      this.listenerCount("error") === 0
    ) {
      dumpSocketError(this, args[0]);
    }
    return Reflect.apply(origEmit, this, [type, ...args]) as boolean;
  };
}

if (process.env.TRACE_SOCKET_ERRORS) {
  installSocketErrorTracing();
  try {
    fs.writeFileSync(2, `${TAG} enabled (TRACE_SOCKET_ERRORS=${process.env.TRACE_SOCKET_ERRORS})\n`);
  } catch {
    /* ignore */
  }
}
