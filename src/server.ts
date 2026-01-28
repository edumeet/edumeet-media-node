process.title = 'edumeet-media-node';

import minimist from 'minimist';
import fs from 'fs';
import os from 'os';
import https from 'https';
import { Server as IOServer } from 'socket.io';
import { interactiveServer, interactiveServerAddMediaService } from './interactiveServer';
import MediaService from './MediaService';
import RoomServer from './RoomServer';
import { RoomServerConnection } from './RoomServerConnection';
import { Logger } from 'edumeet-common';
import { createHttpEndpoints } from './httpEndpoints';
import { IOServerConnection } from './common/IOServerConnection';
import LoadManager from './LoadManager';

const logger = new Logger('MediaNode');

const showUsage = () => {
	logger.debug('Usage:');
	logger.debug('  --listenPort <port> (optional, default: 3000)');
	logger.debug('    The port to listen for incoming connections socket connections.\n\n');
	logger.debug('  --listenHost <host> (optional, default: 0.0.0.0)');
	logger.debug('    The host to listen for incoming connections socket connections.\n\n');
	logger.debug('  --secret <string> (optional, default: none)');
	logger.debug('    The secret to use for authenticating with the room server.\n\n');
	logger.debug('  --availableUpload <bitrate> (optional, default: 1000)');
	logger.debug('    The available upload bandwidth in Mbps.\n\n');
	logger.debug('  --availableDownload <bitrate> (optional, default: 1000)');
	logger.debug('    The available download bandwidth in Mbps.\n\n');
	logger.debug('  --cert <path> (optional, default: ./certs/edumeet-demo-cert.pem)');
	logger.debug('    The path to the certificate file used for socket.\n\n');
	logger.debug('  --key <path> (optional, default: ./certs/edumeet-demo-key.pem)');
	logger.debug('    The path to the key file used for socket.\n\n');
	logger.debug('  --ip <ip> (required)');
	logger.debug('    The IP address used to create mediasoup transports.\n\n');
	logger.debug('  --ip6 <ip> (required)');
	logger.debug('    The IPv6 address used to create mediasoup transports.\n\n');
	logger.debug('  --announcedIp <ip> (optional, default: none)');
	logger.debug('    The IPv4 address to be announced to clients for mediasoup transports.\n\n');
	logger.debug('  --announcedIp6 <ip> (optional, default: none)');
	logger.debug('    The IPv6 address to be announced to clients for mediasoup transports.\n\n');
	logger.debug('  --initialAvailableOutgoingBitrate <bitrate> (optional, default: 600000)');
	logger.debug('    The initial available outgoing bitrate for mediasoup transports.\n\n');
	logger.debug('  --maxIncomingBitrate <bitrate> (optional, default: 10000000)');
	logger.debug('    The max incoming bitrate for mediasoup transports.\n\n');
	logger.debug('  --maxOutgoingBitrate <bitrate> (optional, default: 10000000)');
	logger.debug('    The max outgoing bitrate for mediasoup transports.\n\n');
	logger.debug('  --rtcMinPort <port> (optional, default: 40000)');
	logger.debug('    The lower bound port for mediasoup transport.\n\n');
	logger.debug('  --rtcMaxPort <port> (optional, default: 40249)');
	logger.debug('    The upper bound port for mediasoup transport.\n\n');
	logger.debug('  --numberOfWorkers <num> (optional, default: number of host cores)');
	logger.debug('    The number of mediasoup workers to create.\n\n');
	logger.debug('  --useObserveRTC <boolean> (optional, default: true)');
	logger.debug('    Flag indicate to use ObserveRTC plugin for monitoring the SFU.\n\n');
	logger.debug('  --pollStatsProbability <[0..1]> (optional, default: 1.0)');
	logger.debug('    The probability of polling stats by the monitor from transports, producers, consumers, dataProducers or dataConsumers.\n\n');
	logger.debug('  --loadPollingInterval <ms> (optional, default: 10000)');
	logger.debug('    The interval in ms to poll load usage.\n\n');
	logger.debug('  --cpuPercentCascadingLimit <percent> (optional, default: 66)');
	logger.debug('    The CPU usage percent limit to start cascading.\n\n');
};

const roomServerConnections = new Map<string, RoomServerConnection>();
const roomServers = new Map<string, RoomServer>();

let draining = false;
let drainingTimeout: NodeJS.Timeout;
let drainingStarted: number;
let drainingTime: number;

export const drain = (timeout: number): boolean => {
	if (draining) return false;

	draining = true;

	logger.info({ timeout }, 'drain() | started with timeout in seconds');

	drainingTimeout = setTimeout(() => {
		logger.info('drain() | timeout reached, closing all rooms and room-server connections...');

		roomServers.forEach((roomServer) => roomServer.close());

	}, timeout * 1000);

	drainingTime = timeout * 1000;
	drainingStarted = Date.now();
	roomServerConnections.forEach((roomServerConnection) => roomServerConnection.drain(timeout));

	return true;
};

export const cancelDrain = () => {
	if (!draining) return;

	logger.info('cancelDrain()');

	draining = false;

	clearTimeout(drainingTimeout);
};

(async () => {
	const {
		help,
		usage,
		listenPort = 3000,
		listenHost = '0.0.0.0',
		secret,
		availableUpload = 1000,
		availableDownload = 1000,
		cert = './certs/edumeet-demo-cert.pem',
		key = './certs/edumeet-demo-key.pem',
		ip,
		ip6,
		announcedIp,
		announcedIp6,
		initialAvailableOutgoingBitrate = 600000,
		maxIncomingBitrate = 10000000,
		maxOutgoingBitrate = 10000000,
		rtcMinPort = 40000,
		rtcMaxPort = 40249,
		numberOfWorkers = os.cpus().length,
		useObserveRTC = true,
		pollStatsProbability = 1.0,
		loadPollingInterval = 10_000,
		cpuPercentCascadingLimit = 66,
	} = minimist(process.argv.slice(2));
	
	if (!ip || help || usage) {
		showUsage();
	
		return process.exit(1);
	}

	logger.info({ listenPort, listenHost, ip, announcedIp, ip6, announcedIp6 }, 'Starting...');

	interactiveServer(roomServerConnections, roomServers);

	const mediaService = await MediaService.create({
		ip,
		ip6,
		announcedIp,
		announcedIp6,
		initialAvailableOutgoingBitrate,
		maxIncomingBitrate,
		maxOutgoingBitrate,
		rtcMinPort,
		rtcMaxPort,
		numberOfWorkers,
		useObserveRTC,
		pollStatsProbability,
		loadPollingInterval,
		cpuPercentCascadingLimit,
	}).catch((error) => {
		logger.error({ error }, 'MediaService creation failed');

		return process.exit(1);
	});

	const loadManager = new LoadManager(mediaService, { upload: availableUpload, download: availableDownload }, loadPollingInterval);

	interactiveServerAddMediaService(mediaService);

	const httpEndpoints = createHttpEndpoints(mediaService, loadManager);

	const httpsServer = https.createServer({
		cert: fs.readFileSync(cert),
		key: fs.readFileSync(key),
		minVersion: 'TLSv1.2',
		ciphers: [
			'ECDHE-ECDSA-AES128-GCM-SHA256',
			'ECDHE-RSA-AES128-GCM-SHA256',
			'ECDHE-ECDSA-AES256-GCM-SHA384',
			'ECDHE-RSA-AES256-GCM-SHA384',
			'ECDHE-ECDSA-CHACHA20-POLY1305',
			'ECDHE-RSA-CHACHA20-POLY1305',
			'DHE-RSA-AES128-GCM-SHA256',
			'DHE-RSA-AES256-GCM-SHA384'
		].join(':'),
		honorCipherOrder: true
	});

	httpsServer.on('request', httpEndpoints);

	httpsServer.listen({ port: listenPort, host: listenHost }, () =>
		logger.info({ listenPort }, 'httpsServer.listen()'));

	const socketServer = new IOServer(httpsServer, {
		cors: { origin: [ '*' ] },
		cookie: false
	});

	socketServer.on('connection', (socket) => {
		logger.info({ socketId: socket.id }, 'socket connection');

		const { secret: connectionSecret } = socket.handshake.query;

		if (connectionSecret !== secret) {
			logger.error({ socketId: socket.id }, 'invalid secret');

			return socket.disconnect(true);
		}

		const roomServerConnection = new RoomServerConnection({
			connection: new IOServerConnection(socket),
			loadManager
		});

		if (draining) {
			logger.info({ socketId: socket.id }, 'socket connection | new socket connection rejected - draining');

			const remaining = Math.max(0, drainingTime - (Date.now() - drainingStarted)) / 1000;

			roomServerConnection.drain(remaining);
			roomServerConnection.close();

			return;
		}

		roomServerConnections.set(socket.id, roomServerConnection);
		roomServerConnection.once('close', () =>
			roomServerConnections.delete(socket.id));

		const roomServer = new RoomServer({
			mediaService,
			roomServerConnection
		});

		roomServers.set(socket.id, roomServer);
		roomServer.once('close', () => roomServers.delete(socket.id));
	});

	const close = () => {
		logger.info('close()');

		roomServerConnections.forEach((roomServerConnection) =>
			roomServerConnection.close());
		roomServers.forEach((roomServer) => roomServer.close());
		mediaService.close();
		httpsServer.close();

		process.exit(0);
	};

	process.once('SIGINT', close);
	process.once('SIGQUIT', close);
	process.once('SIGTERM', close);

	logger.info('Started!');
})();
