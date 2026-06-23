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
import { ObserverService } from './ObserverService';
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
	logger.debug('  --loadPollingInterval <ms> (optional, default: 10000)');
	logger.debug('    The interval in ms to poll load usage.\n\n');
	logger.debug('  --cpuPercentCascadingLimit <percent> (optional, default: 66)');
	logger.debug('    The CPU usage percent limit to start cascading.\n\n');
	logger.debug('  --clientSamplesOutputDirectory <path> (optional, default: none)');
	logger.debug('    Local directory to write observertc JSONL sample files to.\n\n');
	logger.debug('  --s3 <bucket[//endpoint]> (optional, default: none)');
	logger.debug('    Enable observertc JSONL uploads to S3 or any S3-compatible store.');
	logger.debug('    bucket   — target bucket name (required)');
	logger.debug('    endpoint — custom endpoint URL, separated by // (optional).');
	logger.debug('               Omit for AWS S3; set for MinIO or other compatible stores.');
	logger.debug('               Path-style URLs are enabled automatically when an endpoint is given.');
	logger.debug('    Credentials are resolved via the standard AWS SDK credential chain');
	logger.debug('    (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars, IAM role, etc.).');
	logger.debug('    Examples:');
	logger.debug('      --s3 my-bucket');
	logger.debug('      --s3 "my-bucket//http://minio.minio-ns.svc.cluster.local:9000"\n\n');
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

	logger.debug('drain()');

	drainingTimeout = setTimeout(() => {
		logger.debug('drain() | closing...');

		process.exit(0);
	}, timeout * 1000);

	drainingTime = timeout * 1000;
	drainingStarted = Date.now();
	roomServerConnections.forEach((roomServerConnection) => roomServerConnection.drain(timeout));

	return true;
};

export const cancelDrain = () => {
	if (!draining) return;

	logger.debug('cancelDrain()');

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
		loadPollingInterval = 10_000,
		cpuPercentCascadingLimit = 66,
		clientSamplesOutputDirectory,
		s3,
	} = minimist(process.argv.slice(2));

	const s3Parts = typeof s3 === 'string' ? s3.split('//') : [];
	const s3Bucket   = s3Parts[0] || undefined;
	const s3Endpoint = s3Parts.length > 1 ? s3Parts.slice(1).join('//') : undefined;

	if (!ip || help || usage) {
		showUsage();

		return process.exit(1);
	}

	logger.debug('Starting...', { listenPort, listenHost, ip, announcedIp, ip6, announcedIp6 });

	interactiveServer(roomServerConnections, roomServers);

	const observerService = new ObserverService({
		clientSamplesOutputDirectory,
		s3Bucket,
		s3Endpoint,
	});

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
		loadPollingInterval,
		cpuPercentCascadingLimit,
	}).catch((error) => {
		logger.error('MediaService creation failed: %o', error);

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
		logger.debug('httpsServer.listen() [port: %s]', listenPort));

	const socketServer = new IOServer(httpsServer, {
		cors: { origin: [ '*' ] },
		cookie: false
	});

	socketServer.on('connection', (socket) => {
		logger.debug(
			'socket connection [socketId: %s]',
			socket.id
		);

		const { secret: connectionSecret } = socket.handshake.query;

		if (connectionSecret !== secret) {
			logger.error(
				'invalid secret [socketId: %s]',
				socket.id
			);

			return socket.disconnect(true);
		}

		const roomServerConnection = new RoomServerConnection({
			connection: new IOServerConnection(socket),
			loadManager
		});

		if (draining) {
			logger.debug(
				'socket connection | draining [socketId: %s]',
				socket.id
			);

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
			observerService,
			roomServerConnection
		});

		roomServers.set(socket.id, roomServer);
		roomServer.once('close', () => roomServers.delete(socket.id));
	});

	const close = () => {
		logger.debug('close()');

		roomServerConnections.forEach((roomServerConnection) =>
			roomServerConnection.close());
		roomServers.forEach((roomServer) => roomServer.close());
		observerService.close();
		mediaService.close();
		httpsServer.close();

		process.exit(0);
	};

	process.once('SIGINT', close);
	process.once('SIGQUIT', close);
	process.once('SIGTERM', close);

	logger.debug('Started!');
})();
