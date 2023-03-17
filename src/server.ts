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
import { IOServerConnection, Logger } from 'edumeet-common';
import { createHttpEndpoints } from './httpEndpoints';

const logger = new Logger('MediaNode');

const showUsage = () => {
	logger.debug('Usage:');
	logger.debug('  --listenPort <port> (optional, default: 3000)');
	logger.debug('    The port to listen for incoming connections socket connections.\n\n');
	logger.debug('  --listenHost <host> (optional, default: 0.0.0.0)');
	logger.debug('    The host to listen for incoming connections socket connections.\n\n');
	logger.debug('  --secret <string> (optional, default: none)');
	logger.debug('    The secret to use for authenticating with the room server.\n\n');
	logger.debug('  --cert <path> (optional, default: ./certs/edumeet-demo-cert.pem)');
	logger.debug('    The path to the certificate file used for socket.\n\n');
	logger.debug('  --key <path> (optional, default: ./certs/edumeet-demo-key.pem)');
	logger.debug('    The path to the key file used for socket.\n\n');
	logger.debug('  --ip <ip> (required)');
	logger.debug('    The IP address used to create mediasoup transports.\n\n');
	logger.debug('  --announcedIp <ip> (optional, default: none)');
	logger.debug('    The IP address to be announced to clients for mediasoup transports.\n\n');
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
	logger.debug('  --cpuPollingInterval <ms> (optional, default: 10000)');
	logger.debug('    The interval in ms to poll CPU usage.\n\n');
	logger.debug('  --cpuPercentCascadingLimit <percent> (optional, default: 66)');
	logger.debug('    The CPU usage percent limit to start cascading.\n\n');
};

(async () => {
	const {
		help,
		usage,
		listenPort = 3000,
		listenHost = '0.0.0.0',
		secret,
		cert = './certs/edumeet-demo-cert.pem',
		key = './certs/edumeet-demo-key.pem',
		ip,
		announcedIp,
		initialAvailableOutgoingBitrate = 600000,
		maxIncomingBitrate = 10000000,
		maxOutgoingBitrate = 10000000,
		rtcMinPort = 40000,
		rtcMaxPort = 40249,
		numberOfWorkers = os.cpus().length,
		useObserveRTC = true,
		pollStatsProbability = 1.0,
		cpuPollingInterval = 10_000,
		cpuPercentCascadingLimit = 66,
	} = minimist(process.argv.slice(2));
	
	if (!ip || help || usage) {
		showUsage();
	
		return process.exit(1);
	}

	logger.debug('Starting...', { listenPort, listenHost, ip, announcedIp });

	const roomServerConnections = new Map<string, RoomServerConnection>();
	const roomServers = new Map<string, RoomServer>();

	interactiveServer(roomServerConnections, roomServers);

	const mediaService = await MediaService.create({
		ip,
		announcedIp,
		initialAvailableOutgoingBitrate,
		maxIncomingBitrate,
		maxOutgoingBitrate,
		rtcMinPort,
		rtcMaxPort,
		numberOfWorkers,
		useObserveRTC,
		pollStatsProbability,
		cpuPollingInterval,
		cpuPercentCascadingLimit,
	}).catch((error) => {
		logger.error('MediaService creation failed: %o', error);

		return process.exit(1);
	});

	interactiveServerAddMediaService(mediaService);

	const httpEndpoints = createHttpEndpoints(mediaService);

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
			connection: new IOServerConnection(socket)
		});

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
		logger.debug('close()');

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

	logger.debug('Started!');
})();