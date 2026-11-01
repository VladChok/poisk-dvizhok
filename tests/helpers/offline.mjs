// Explicit fixture-only test invocation; inherited by test subprocesses via NODE_OPTIONS.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import dns from 'node:dns';
import {syncBuiltinESMExports} from 'node:module';
const denied = () => { throw new Error('OFFLINE_TEST: network access disabled'); };
globalThis.fetch = denied;
net.connect = net.createConnection = net.Socket.prototype.connect = denied;
tls.connect = denied;
http.request = http.get = https.request = https.get = denied;
dgram.createSocket = denied;
for (const key of Object.keys(dns)) if (/^(lookup|resolve|reverse)/.test(key) && typeof dns[key] === 'function') dns[key] = denied;
for (const key of Object.keys(dns.promises)) if (typeof dns.promises[key] === 'function') dns.promises[key] = denied;
syncBuiltinESMExports();
